"""Evaluates the toxicity model on data it was not trained on: Davidson et al. (2017), "Automated Hate Speech Detection
and the Problem of Offensive Language" (24,783 tweets labelled hate speech / offensive language / neither), from the
Hugging Face hub (tdavidson/hate_speech_offensive, pinned revision). Used for evaluation only; not redistributed.

    python evaluate_toxicity.py      (from services/ml, in its virtualenv, with pyarrow installed)

Writes docs/report-log/results/toxicity-eval.json and prints the tables recorded in docs/report-log/ml-models.md.
"""
import io
import json
import random
import time
import urllib.request
from pathlib import Path

import numpy as np
import pyarrow.parquet as pq

import app  # the service's own model code, so the evaluation measures exactly what ALT runs

REPO = 'tdavidson/hate_speech_offensive'
REV = 'adc5fb774614827695774f2dbe0ea8122f6a92b4'
PER_CLASS = 1430          # every hate-speech tweet (1,430) and as many of each other class
SEED = 42
CLASSES = ['hate speech', 'offensive language', 'neither']


def load():
    files = json.loads(urllib.request.urlopen(f'https://huggingface.co/api/datasets/{REPO}/parquet/default/train?revision={REV}', timeout=60).read())
    rows = []
    for url in files:
        rows += pq.read_table(io.BytesIO(urllib.request.urlopen(url, timeout=120).read())).to_pylist()
    return rows


def main():
    rows = load()
    rng = random.Random(SEED)
    sample = []
    for c in range(3):
        group = [r for r in rows if r['class'] == c]
        sample += rng.sample(group, min(PER_CLASS, len(group)))
    texts = [r['tweet'] for r in sample]
    labels = [r['class'] for r in sample]

    enc = app.Encoder('toxicity')
    cfg = json.loads((app.models.ensure('toxicity') / 'config.json').read_text())
    names = [cfg['id2label'][str(i)] for i in range(len(cfg['id2label']))]
    probs, t0 = [], time.perf_counter()
    for i in range(0, len(texts), 32):
        logits, _ = enc.run(texts[i:i + 32])
        probs.append(1 / (1 + np.exp(-logits)))
    elapsed = time.perf_counter() - t0
    probs = np.vstack(probs)
    scores = [dict(zip(names, map(float, p))) for p in probs]

    def binary(pred, truth):
        tp = sum(p and t for p, t in zip(pred, truth)); fp = sum(p and not t for p, t in zip(pred, truth))
        fn = sum(t and not p for p, t in zip(pred, truth)); tn = len(pred) - tp - fp - fn
        precision = tp / (tp + fp) if tp + fp else 0.0; recall = tp / (tp + fn) if tp + fn else 0.0
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
        return {'precision': round(precision, 3), 'recall': round(recall, 3), 'f1': round(f1, 3),
                'accuracy': round((tp + tn) / len(pred), 3), 'tp': tp, 'fp': fp, 'fn': fn, 'tn': tn}

    harmful = [l in (0, 1) for l in labels]
    levels = [app.level_of(s)[0] for s in scores]
    out = {
        'dataset': f'{REPO}@{REV}', 'sample': {CLASSES[c]: labels.count(c) for c in range(3)}, 'seed': SEED,
        'model': app.models.MODELS['toxicity']['source'], 'onnx': 'int8 quantized',
        'thresholds': {'severe': app.SEVERE, 'toxic': app.TOXIC, 'mild': app.MILD},
        'ms_per_text': round(elapsed / len(texts) * 1000, 2),
        # Posts, comments and AI replies are blocked at "toxic" or "severe".
        'blocked_vs_harmful': binary([l in ('toxic', 'severe') for l in levels], harmful),
        # Direct messages: anything from "mild" up at least asks the sender to confirm.
        'warned_or_blocked_vs_harmful': binary([l != 'none' for l in levels], harmful),
        # Hate speech specifically: blocked at any level vs labelled hate speech (hate vs everything else).
        'blocked_vs_hate': binary([l in ('toxic', 'severe') for l in levels], [l == 0 for l in labels]),
        'confusion': {CLASSES[c]: {lv: sum(1 for l, p in zip(labels, levels) if l == c and p == lv) for lv in ('none', 'mild', 'toxic', 'severe')} for c in range(3)},
        'threshold_sweep_toxic': {},
    }
    for th in (0.5, 0.6, 0.7, 0.8, 0.9):
        pred = [s['severe_toxic'] >= app.SEVERE or s['identity_hate'] >= app.SEVERE or s['threat'] >= app.SEVERE
                or max(s['toxic'], s['insult'], s['obscene']) >= th for s in scores]
        out['threshold_sweep_toxic'][str(th)] = binary(pred, harmful)
    # ROC-AUC of the "toxic" score for harmful vs neither (rank-based, no extra libraries).
    t = np.array([s['toxic'] for s in scores]); y = np.array(harmful)
    order = t.argsort(); ranks = np.empty(len(t)); ranks[order] = np.arange(1, len(t) + 1)
    pos = y.sum(); neg = len(y) - pos
    out['roc_auc_toxic_score'] = round(float((ranks[y].sum() - pos * (pos + 1) / 2) / (pos * neg)), 4)

    dest = Path(__file__).resolve().parents[2] / 'docs' / 'report-log' / 'results'
    dest.mkdir(parents=True, exist_ok=True)
    (dest / 'toxicity-eval.json').write_text(json.dumps(out, indent=2))
    print(json.dumps(out, indent=2))


if __name__ == '__main__':
    main()
