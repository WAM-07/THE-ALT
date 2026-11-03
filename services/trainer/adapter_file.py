"""One file per adapter: the LoRA weights (.safetensors) with their PEFT config inside the file's metadata.

ALT Core stores and serves an adapter as a single file named by its SHA-256. PEFT needs the weights
(adapter_model.safetensors) and the config (adapter_config.json); `pack` puts the config into the
safetensors header (`__metadata__["adapter_config"]`) and `unpack` writes both back out.
The safetensors header is read and written here directly, so no ML library is needed.
"""
from __future__ import annotations

import hashlib
import json
import os
import struct


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _read(path: str) -> tuple[dict, bytes]:
    with open(path, "rb") as f:
        (n,) = struct.unpack("<Q", f.read(8))
        header = json.loads(f.read(n))
        return header, f.read()


def _write(path: str, header: dict, body: bytes) -> None:
    raw = json.dumps(header, separators=(",", ":")).encode()
    raw += b" " * (-len(raw) % 8)  # keep the tensor data 8-byte aligned, as safetensors does
    with open(path, "wb") as f:
        f.write(struct.pack("<Q", len(raw)))
        f.write(raw)
        f.write(body)


def pack(adapter_dir: str, out_path: str) -> str:
    """adapter_dir (from model.save_pretrained) -> one .safetensors file; returns its SHA-256."""
    header, body = _read(os.path.join(adapter_dir, "adapter_model.safetensors"))
    with open(os.path.join(adapter_dir, "adapter_config.json"), encoding="utf-8") as f:
        config = f.read()
    meta = dict(header.get("__metadata__") or {})
    meta["adapter_config"] = config
    meta["packed_by"] = "alt-trainer"
    header["__metadata__"] = meta
    _write(out_path, header, body)
    return sha256_file(out_path)


def unpack(file_path: str, out_dir: str) -> None:
    """One .safetensors file -> a directory PEFT can load (adapter_model.safetensors + adapter_config.json)."""
    header, body = _read(file_path)
    meta = dict(header.get("__metadata__") or {})
    config = meta.pop("adapter_config", None)
    if config is None:
        raise ValueError("This adapter has no adapter_config in its metadata (was it packed by the ALT trainer?).")
    header["__metadata__"] = meta
    os.makedirs(out_dir, exist_ok=True)
    _write(os.path.join(out_dir, "adapter_model.safetensors"), header, body)
    with open(os.path.join(out_dir, "adapter_config.json"), "w", encoding="utf-8") as f:
        f.write(config)
