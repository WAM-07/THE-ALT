"""ALT's trainer: takes trainings from ALT Core, fine-tunes an adapter on the owner's data, returns it.

    python trainer.py --check        is this machine ready (GPU, CUDA, libraries)?
    python trainer.py --once         take one waiting training, if any, and train it
    python trainer.py                keep taking trainings (checks every POLL_SECONDS)

Settings (environment or the repository's .env): CORE_URL (default http://127.0.0.1:4000),
INTERNAL_SERVICE_KEY (the same as ALT Core's), TRAINER_NAME, TRAINER_BASE_MODEL, TRAINER_EPOCHS,
POLL_SECONDS. ALT Core must run with TRAINING_MODE=trainer, or it simulates trainings itself.

The owner's data lives only in memory and a temporary folder while one training runs; the folder is
deleted before the trainer tells Core it is done (Core records that the data was deleted).
"""
from __future__ import annotations

import argparse
import os
import shutil
import sys
import tempfile
import time
import traceback
from typing import Callable

from adapter_file import pack
from alt_client import AltError, AltTrainerClient, Claim
from dataset import build_examples
from qlora import TrainConfig, train_adapter

TrainFn = Callable[[list, str, TrainConfig, Callable[[int, int, float | None], None]], dict]


def load_env_file() -> None:
    """Reads the repository's .env (two folders up) for anything not already set."""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".env")
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                os.environ.setdefault(key.strip(), value.strip().strip('"'))


def run_once(client: AltTrainerClient, cfg: TrainConfig, train: TrainFn = train_adapter, log=print) -> str | None:
    """Takes one training and sees it through. Returns its id, or None when nothing was waiting."""
    claim: Claim | None = client.claim()
    if claim is None:
        return None
    log(f"training {claim.id} (AI {claim.ai_id})")
    work = tempfile.mkdtemp(prefix="alt-train-")
    try:
        client.checkpoint(claim, "preparing your data", 2)
        examples = build_examples(client.data(claim))
        log(f"  {len(examples)} examples, base model {cfg.base_model}")
        client.checkpoint(claim, f"loading {cfg.base_model}", 5)

        last = {"t": 0.0}

        def progress(step: int, total: int, loss: float | None):
            # At most one checkpoint every 10 s (each also renews the claim).
            if time.time() - last["t"] >= 10 or step >= total:
                last["t"] = time.time()
                client.checkpoint(claim, f"training: step {step} of {total}", 5 + int(85 * step / max(total, 1)), step, loss)

        scores = train(examples, os.path.join(work, "adapter"), cfg, progress)
        client.checkpoint(claim, "saving the adapter", 92)
        file_path = os.path.join(work, "adapter.safetensors")
        pack(os.path.join(work, "adapter"), file_path)
        stored = client.upload_adapter(claim, file_path)
        # The owner's data and the work folder go before Core is told the data was deleted.
        del examples
        shutil.rmtree(work, ignore_errors=True)
        client.complete(claim, stored["adapterSha256"], stored["adapterUri"], cfg.base_model, scores)
        log(f"  done: adapter {stored['adapterSha256'][:12]}…, loss {scores.get('loss')}")
        return claim.id
    except Exception as err:  # noqa: BLE001 - report every failure to Core
        log(f"  failed: {err}")
        traceback.print_exc()
        try:
            client.fail(claim, getattr(err, "code", None) or type(err).__name__.upper()[:60], str(err)[:500])
        except AltError:
            pass
        return claim.id
    finally:
        shutil.rmtree(work, ignore_errors=True)


def check() -> int:
    """What this machine has, and what is missing for training."""
    ok = True
    print(f"Python {sys.version.split()[0]}")
    try:
        import torch

        print(f"PyTorch {torch.__version__}, CUDA build {torch.version.cuda}")
        if torch.cuda.is_available():
            p = torch.cuda.get_device_properties(0)
            print(f"GPU: {p.name}, {p.total_memory / 2**30:.1f} GB")
            if p.total_memory < 7.5 * 2**30:
                print("  Warning: under 8 GB; use a smaller base model (TRAINER_BASE_MODEL=Qwen/Qwen2.5-1.5B-Instruct).")
        else:
            ok = False
            print("No CUDA GPU visible. Install the NVIDIA driver and PyTorch with CUDA (see services/trainer/README.md).")
    except ImportError:
        ok = False
        print("PyTorch is not installed (see services/trainer/README.md, step 3).")
    for lib in ("transformers", "peft", "bitsandbytes", "accelerate"):
        try:
            mod = __import__(lib)
            print(f"{lib} {getattr(mod, '__version__', '?')}")
        except Exception as err:  # noqa: BLE001
            ok = False
            print(f"{lib}: missing or broken ({err})")
    key = os.environ.get("INTERNAL_SERVICE_KEY")
    print(f"CORE_URL {os.environ.get('CORE_URL', 'http://127.0.0.1:4000')}, service key {'set' if key else 'MISSING'}")
    ok = ok and bool(key)
    print("Ready to train." if ok else "Not ready yet.")
    return 0 if ok else 1


def main() -> int:
    load_env_file()
    parser = argparse.ArgumentParser(description="ALT's trainer")
    parser.add_argument("--check", action="store_true", help="check this machine and stop")
    parser.add_argument("--once", action="store_true", help="take one waiting training and stop")
    args = parser.parse_args()
    if args.check:
        return check()
    key = os.environ.get("INTERNAL_SERVICE_KEY")
    if not key:
        print("INTERNAL_SERVICE_KEY is not set (it must match ALT Core's).")
        return 1
    client = AltTrainerClient(os.environ.get("CORE_URL", "http://127.0.0.1:4000"), key, os.environ.get("TRAINER_NAME", "alt-trainer"))
    cfg = TrainConfig(
        base_model=os.environ.get("TRAINER_BASE_MODEL", TrainConfig.base_model),
        epochs=float(os.environ.get("TRAINER_EPOCHS", TrainConfig.epochs)),
    )
    poll = float(os.environ.get("POLL_SECONDS", "15"))
    while True:
        try:
            done = run_once(client, cfg)
        except (AltError, OSError) as err:
            print(f"ALT Core not reachable or refused: {err}")
            done = None
        if args.once:
            return 0
        if done is None:
            time.sleep(poll)


if __name__ == "__main__":
    sys.exit(main())
