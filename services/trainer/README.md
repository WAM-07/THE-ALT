# ALT's trainer (Module 9: the engine)

Fine-tunes a personal AI on its owner's data with **QLoRA** and hands the result (a LoRA adapter) to
ALT Core. Then `inference.py` lets trained versions answer with their adapter.

```
ALT Core ──(trainer socket, service key)──► trainer.py ──► qlora.py (GPU) ──► adapter ──► ALT Core
ALT Core ──(POST /v1/adapter-chat)────────► inference.py (GPU) ── base model + the AI's adapter
```

| File | What it does |
|---|---|
| `trainer.py` | Takes a waiting training from Core, builds the examples, trains, packs and uploads the adapter, tells Core it is done (and that the data was deleted). `--check` tests the machine. |
| `qlora.py` | The training: base model in 4-bit (NF4), LoRA rank 16 on all attention and MLP layers, 3 epochs, learning rate 2e-4, only the assistant turns learned. |
| `dataset.py` | Turns the owner's writing samples, documents and memories into chat examples. |
| `adapter_file.py` | One file per adapter: the weights with the PEFT config inside the safetensors header. |
| `alt_client.py` | The trainer socket (`/internal/trainer/*`), standard library only. |
| `inference.py` | Serves trained versions: fetches each adapter once from Core (checks its SHA-256), switches adapters per request. |
| `tests/` | Everything that needs no GPU: `python -m unittest discover -s tests` |

The default base model is **Qwen/Qwen2.5-3B-Instruct** (Apache-2.0, no sign-up needed, fits an 8 GB
card in 4-bit). Change it with `TRAINER_BASE_MODEL`.

## Setting it up on the RTX 3070 PC (Windows)

1. **NVIDIA driver.** Install the latest Game Ready or Studio driver from nvidia.com/drivers. Check in
   a terminal: `nvidia-smi` shows the RTX 3070 and a "CUDA Version" of 12.4 or higher.
2. **Python 3.12** (already on this PC). In `C:\THE ALT\services\trainer`:
   ```
   python -m venv .venv
   .venv\Scripts\activate
   ```
3. **PyTorch with CUDA** (from PyTorch's own index, not plain pip):
   ```
   pip install torch --index-url https://download.pytorch.org/whl/cu124
   ```
4. **The rest:** `pip install -r requirements.txt`
5. **Check:** `python trainer.py --check` should end with "Ready to train." It reads
   `INTERNAL_SERVICE_KEY` from the repository's `.env` (the same key ALT Core uses).
6. **Tell ALT Core to wait for a real trainer** in the repository's `.env`:
   ```
   TRAINING_MODE=trainer
   ADAPTER_INFERENCE_URL=http://127.0.0.1:4600
   ```
   and restart `npm run dev`. (Without this, Core keeps simulating trainings.)
7. **Run the inference server** (second terminal, venv active): `uvicorn inference:app --host 127.0.0.1 --port 4600`
8. **Run the trainer** (third terminal, venv active): `python trainer.py`
9. In ALTER: Identity → the "trained" check → **Train**. The trainer picks it up within 15 s; the
   checkpoints appear in ALTER. The first run downloads the base model (about 6 GB) from Hugging Face.

Times on an RTX 3070 (estimates): a few hundred examples take 5–20 minutes.

## If something goes wrong

| Message | What to do |
|---|---|
| `No CUDA GPU visible` | Driver missing, or PyTorch without CUDA: repeat step 3 inside the venv. |
| `CUDA out of memory` | Close games or other GPU apps; or `TRAINER_BASE_MODEL=Qwen/Qwen2.5-1.5B-Instruct`. |
| `bitsandbytes … missing or broken` | `pip install -U bitsandbytes` (0.43+ supports Windows). |
| `SERVICE_UNAUTHORIZED` | `INTERNAL_SERVICE_KEY` differs from ALT Core's: use the one in `.env`. |
| `Nothing to learn from` | The AI has no writing, documents or memories: chat with it and add data in ALTER first. |
