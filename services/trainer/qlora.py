"""QLoRA fine-tuning of an open base model on one owner's examples (needs an NVIDIA GPU).

The base model is loaded in 4-bit (bitsandbytes NF4) and only small LoRA matrices are trained, so a
3-4B model fits an 8 GB card such as the RTX 3070. Only the assistant turns are learned (the system
prompt and the question are masked out). The result is a LoRA adapter, saved with PEFT.
ML libraries are imported inside the function, so the rest of the trainer runs without them.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable


@dataclass
class TrainConfig:
    base_model: str = "Qwen/Qwen2.5-3B-Instruct"
    epochs: float = 3.0
    learning_rate: float = 2e-4
    rank: int = 16
    max_length: int = 1024
    batch_size: int = 1
    grad_accum: int = 8


def train_adapter(examples: list[list[dict]], out_dir: str, cfg: TrainConfig, on_progress: Callable[[int, int, float | None], None]) -> dict:
    import torch
    from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig, Trainer, TrainerCallback, TrainingArguments

    if not torch.cuda.is_available():
        raise RuntimeError("No CUDA GPU found. Run `python trainer.py --check` for what is missing.")

    tok = AutoTokenizer.from_pretrained(cfg.base_model)
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token

    rows = []
    for messages in examples:
        full = tok.apply_chat_template(messages, tokenize=True, add_generation_prompt=False)[: cfg.max_length]
        prompt = tok.apply_chat_template(messages[:-1], tokenize=True, add_generation_prompt=True)
        labels = [-100] * min(len(prompt), len(full)) + full[len(prompt):]
        if any(x != -100 for x in labels):
            rows.append({"input_ids": full, "labels": labels[: len(full)]})
    if not rows:
        raise ValueError("Nothing to learn from: add writing, documents or memories to the AI first.")

    class Rows(torch.utils.data.Dataset):
        def __len__(self):
            return len(rows)

        def __getitem__(self, i):
            return rows[i]

    def collate(batch):
        n = max(len(b["input_ids"]) for b in batch)
        pad = tok.pad_token_id
        return {
            "input_ids": torch.tensor([b["input_ids"] + [pad] * (n - len(b["input_ids"])) for b in batch]),
            "labels": torch.tensor([b["labels"] + [-100] * (n - len(b["labels"])) for b in batch]),
            "attention_mask": torch.tensor([[1] * len(b["input_ids"]) + [0] * (n - len(b["input_ids"])) for b in batch]),
        }

    quant = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_compute_dtype=torch.float16, bnb_4bit_use_double_quant=True)
    model = AutoModelForCausalLM.from_pretrained(cfg.base_model, quantization_config=quant, device_map="auto")
    model = prepare_model_for_kbit_training(model, use_gradient_checkpointing=True)
    model = get_peft_model(
        model,
        LoraConfig(
            r=cfg.rank,
            lora_alpha=cfg.rank * 2,
            lora_dropout=0.05,
            bias="none",
            task_type="CAUSAL_LM",
            target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
        ),
    )

    class Progress(TrainerCallback):
        def on_log(self, args, state, control, logs=None, **kwargs):
            on_progress(state.global_step, state.max_steps or 1, (logs or {}).get("loss"))

    args = TrainingArguments(
        output_dir=f"{out_dir}/_work",
        per_device_train_batch_size=cfg.batch_size,
        gradient_accumulation_steps=cfg.grad_accum,
        num_train_epochs=cfg.epochs,
        learning_rate=cfg.learning_rate,
        lr_scheduler_type="cosine",
        warmup_ratio=0.03,
        fp16=True,
        optim="paged_adamw_8bit",
        logging_steps=1,
        save_strategy="no",
        report_to=[],
    )
    trainer = Trainer(model=model, args=args, train_dataset=Rows(), data_collator=collate, callbacks=[Progress()])
    result = trainer.train()
    model.save_pretrained(out_dir, safe_serialization=True)
    return {"loss": float(result.training_loss), "examples": len(rows), "steps": int(result.global_step)}
