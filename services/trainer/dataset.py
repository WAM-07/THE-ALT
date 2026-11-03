"""Turns the consented data ALT Core exports into chat examples for fine-tuning (no ML libraries needed).

What the adapter should learn:
  - how the owner writes   -> their own messages and "communication style" items (`samples`)
  - what the owner knows   -> their documents (`documents`), in passages
  - what is true about them -> their approved memories (`memories`)
Every example starts with a short system prompt naming the AI, as ALT Core's persona engine does.
"""
from __future__ import annotations

import random

VOICE_PROMPTS = [
    "Say something in your own words.",
    "What's on your mind?",
    "Share a thought, the way you usually would.",
    "Tell me something you would say.",
    "Write a short message, in your style.",
]
MEMORY_PROMPTS = ["What do you know about me?", "Tell me something about yourself.", "What should I remember about you?"]
MAX_EXAMPLES = 2000


def system_prompt(data: dict) -> str:
    ai = data.get("ai") or {}
    persona = data.get("persona") or {}
    name = ai.get("name") or "the AI"
    lines = [f"You are {name}, a personal AI in The ALT Ecosystem. You are an AI, not a human."]
    if persona.get("about"):
        lines.append(f"About you: {persona['about']}")
    if persona.get("traits"):
        lines.append(f"Personality: {', '.join(persona['traits'])}.")
    if persona.get("interests"):
        lines.append(f"Interests: {', '.join(persona['interests'])}.")
    return "\n".join(lines)


def passages(text: str, size: int = 800) -> list[str]:
    """Paragraph-aware chunks of at most `size` characters (long paragraphs are split on spaces)."""
    out: list[str] = []
    current = ""
    for para in [p.strip() for p in text.split("\n\n") if p.strip()]:
        while len(para) > size:
            cut = para.rfind(" ", 0, size)
            cut = cut if cut > size // 2 else size
            if current:
                out.append(current)
                current = ""
            out.append(para[:cut].strip())
            para = para[cut:].strip()
        if len(current) + len(para) + 2 > size and current:
            out.append(current)
            current = para
        else:
            current = f"{current}\n\n{para}" if current else para
    if current:
        out.append(current)
    return out


def build_examples(data: dict, seed: int = 7) -> list[list[dict]]:
    """Chat examples [{role, content}, ...] ending with the assistant turn the model learns."""
    rnd = random.Random(seed)
    system = {"role": "system", "content": system_prompt(data)}
    examples: list[list[dict]] = []
    for sample in data.get("samples") or []:
        if sample and sample.strip():
            examples.append([system, {"role": "user", "content": rnd.choice(VOICE_PROMPTS)}, {"role": "assistant", "content": sample.strip()}])
    for doc in data.get("documents") or []:
        title = (doc.get("title") or "your notes").strip()
        parts = passages(doc.get("text") or "")
        for i, part in enumerate(parts):
            ask = f"What do your notes on {title} say?" if len(parts) == 1 else f"What do your notes on {title} say (part {i + 1} of {len(parts)})?"
            examples.append([system, {"role": "user", "content": ask}, {"role": "assistant", "content": part}])
    for memory in data.get("memories") or []:
        if memory and memory.strip():
            examples.append([system, {"role": "user", "content": rnd.choice(MEMORY_PROMPTS)}, {"role": "assistant", "content": memory.strip()}])
    rnd.shuffle(examples)
    return examples[:MAX_EXAMPLES]
