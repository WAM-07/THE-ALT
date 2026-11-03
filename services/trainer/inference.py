"""ALT's inference server for trained adapters (the inference socket; needs an NVIDIA GPU).

ALT Core calls POST /v1/adapter-chat when a version trained by ALT's trainer (or uploaded by its owner)
speaks, if ADAPTER_INFERENCE_URL points here. The base model is loaded once in 4-bit; each adapter is
fetched from Core once (checked against its SHA-256), cached on disk, and switched in per request.

    uvicorn inference:app --host 127.0.0.1 --port 4600
    (then ALT Core: ADAPTER_INFERENCE_URL=http://127.0.0.1:4600)
"""
from __future__ import annotations

import hashlib
import hmac
import os
import threading

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

from adapter_file import unpack
from alt_client import AltTrainerClient
from trainer import load_env_file

load_env_file()
SERVICE_KEY = os.environ.get("INTERNAL_SERVICE_KEY", "")
CACHE = os.environ.get("ADAPTER_CACHE", os.path.join(os.path.dirname(os.path.abspath(__file__)), ".adapters"))
core = AltTrainerClient(os.environ.get("CORE_URL", "http://127.0.0.1:4000"), SERVICE_KEY, "alt-inference")
app = FastAPI(title="ALT adapter inference")
lock = threading.Lock()  # one generation at a time on one GPU
state: dict = {"base": None, "model": None, "tok": None, "loaded": set()}


class Message(BaseModel):
    role: str
    content: str


class ChatIn(BaseModel):
    baseModel: str
    adapterUri: str
    adapterSha256: str
    messages: list[Message]
    temperature: float = 0.7
    maxTokens: int = 450


def adapter_dir(uri: str, sha: str) -> str:
    """Fetches alt://adapters/<sha>.<format> from Core once, checks it, and unpacks it for PEFT."""
    name = uri.removeprefix("alt://adapters/")
    if name != f"{sha}.safetensors":
        raise HTTPException(400, "Only adapters packed by the ALT trainer (.safetensors) can be served here.")
    folder = os.path.join(CACHE, sha)
    if not os.path.exists(os.path.join(folder, "adapter_config.json")):
        raw = core.download_adapter(name)
        if hashlib.sha256(raw).hexdigest() != sha:
            raise HTTPException(502, "The adapter Core sent does not match its fingerprint.")
        os.makedirs(CACHE, exist_ok=True)
        packed = os.path.join(CACHE, name)
        with open(packed, "wb") as f:
            f.write(raw)
        unpack(packed, folder)
    return folder


def model_for(base: str, sha: str, folder: str):
    import torch
    from peft import PeftModel
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

    if state["base"] != base:
        quant = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_compute_dtype=torch.float16)
        base_model = AutoModelForCausalLM.from_pretrained(base, quantization_config=quant, device_map="auto")
        state.update(base=base, tok=AutoTokenizer.from_pretrained(base), model=PeftModel.from_pretrained(base_model, folder, adapter_name=sha), loaded={sha})
    elif sha not in state["loaded"]:
        state["model"].load_adapter(folder, adapter_name=sha)
        state["loaded"].add(sha)
    state["model"].set_adapter(sha)
    return state["model"], state["tok"]


@app.get("/health")
def health():
    return {"ok": True, "base": state["base"], "adapters": len(state["loaded"])}


@app.post("/v1/adapter-chat")
def adapter_chat(body: ChatIn, x_alt_service_key: str = Header(default="")):
    if not SERVICE_KEY or not hmac.compare_digest(x_alt_service_key, SERVICE_KEY):
        raise HTTPException(401, "Service credentials required.")
    import torch

    folder = adapter_dir(body.adapterUri, body.adapterSha256)
    with lock:
        model, tok = model_for(body.baseModel, body.adapterSha256, folder)
        ids = tok.apply_chat_template([m.model_dump() for m in body.messages], add_generation_prompt=True, return_tensors="pt").to(model.device)
        with torch.no_grad():
            out = model.generate(
                ids,
                max_new_tokens=max(16, min(body.maxTokens, 1024)),
                do_sample=body.temperature > 0,
                temperature=max(body.temperature, 0.05),
                top_p=0.9,
                pad_token_id=tok.pad_token_id or tok.eos_token_id,
            )
    new = out[0][ids.shape[1]:]
    return {"text": tok.decode(new, skip_special_tokens=True).strip(), "tokensIn": int(ids.shape[1]), "tokensOut": int(new.shape[0])}
