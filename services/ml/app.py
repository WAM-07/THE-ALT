"""ALT ML service: the models ALT Core calls (internal only; 127.0.0.1, behind the service key).

  GET  /health                 models loaded, their sources
  POST /toxicity {texts}       per text: six label scores and a level (none | mild | toxic | severe)
  POST /embed {texts, kind}    L2-normalised sentence embeddings (kind: passage | query)

Run:  python -m uvicorn app:app --host 127.0.0.1 --port 4500   (from services/ml, in its virtualenv)
"""
import os
import time
from contextlib import asynccontextmanager

import numpy as np
import onnxruntime as ort
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
from tokenizers import Tokenizer

import models

MAX_TEXTS = 64
MAX_TOKENS = 256

# Levels from the toxicity scores (sigmoid probabilities). Tuned on a held-out evaluation set; see
# docs/report-log/ml-models.md. "severe": identity-based hate, threats, severe toxicity. "toxic": clearly toxic or
# insulting. "mild": borderline. Posts, comments and AI replies block toxic and severe; direct messages between
# people block severe and ask the sender to confirm toxic or mild.
SEVERE = float(os.environ.get('ML_TOX_SEVERE', '0.5'))
TOXIC = float(os.environ.get('ML_TOX_TOXIC', '0.8'))
MILD = float(os.environ.get('ML_TOX_MILD', '0.5'))
# ALT's moderation categories for the model's six labels.
CATEGORY = {'identity_hate': 'hate', 'threat': 'threat', 'severe_toxic': 'severe_toxicity', 'insult': 'insult',
            'obscene': 'obscenity', 'toxic': 'toxicity'}


class Encoder:
    """A tokenizer and an ONNX session for one model."""

    def __init__(self, name: str):
        folder = models.ensure(name)
        self.tokenizer = Tokenizer.from_file(str(folder / 'tokenizer.json'))
        self.tokenizer.enable_truncation(max_length=MAX_TOKENS)
        self.tokenizer.enable_padding()
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = int(os.environ.get('ML_THREADS', '2'))
        self.session = ort.InferenceSession(str(folder / 'model.onnx'), opts, providers=['CPUExecutionProvider'])
        self.inputs = {i.name for i in self.session.get_inputs()}

    def run(self, texts: list[str]):
        enc = self.tokenizer.encode_batch(texts)
        feed = {'input_ids': np.array([e.ids for e in enc], dtype=np.int64),
                'attention_mask': np.array([e.attention_mask for e in enc], dtype=np.int64)}
        if 'token_type_ids' in self.inputs:
            feed['token_type_ids'] = np.array([e.type_ids for e in enc], dtype=np.int64)
        return self.session.run(None, feed)[0], feed['attention_mask']


state: dict = {}


@asynccontextmanager
async def lifespan(_app):
    state['toxicity'] = Encoder('toxicity')
    import json
    cfg = json.loads((models.ensure('toxicity') / 'config.json').read_text())
    state['labels'] = [cfg['id2label'][str(i)] for i in range(len(cfg['id2label']))]
    state['embeddings'] = Encoder('embeddings')
    yield


app = FastAPI(title='ALT ML service', lifespan=lifespan)


def guard(key: str | None):
    expected = os.environ.get('INTERNAL_SERVICE_KEY')
    if not expected and os.environ.get('NODE_ENV') == 'production':
        raise HTTPException(status_code=503, detail='INTERNAL_SERVICE_KEY is not set')
    if expected and key != expected:
        raise HTTPException(status_code=401, detail='service key required')


class Texts(BaseModel):
    texts: list[str] = Field(min_length=1, max_length=MAX_TEXTS)
    kind: str = 'passage'


def level_of(scores: dict) -> tuple[str, list[str]]:
    severe = [l for l in ('identity_hate', 'threat', 'severe_toxic') if scores[l] >= SEVERE]
    if severe:
        return 'severe', [CATEGORY[l] for l in severe]
    strong = [l for l in ('toxic', 'insult', 'obscene') if scores[l] >= TOXIC]
    if strong:
        return 'toxic', [CATEGORY[l] for l in strong]
    if scores['toxic'] >= MILD:
        return 'mild', ['toxicity']
    return 'none', []


@app.get('/health')
def health():
    return {'status': 'ok', 'models': {n: models.MODELS[n]['source'] for n in models.MODELS},
            'thresholds': {'severe': SEVERE, 'toxic': TOXIC, 'mild': MILD}}


@app.post('/toxicity')
def toxicity(body: Texts, x_alt_service_key: str | None = Header(default=None)):
    guard(x_alt_service_key)
    t0 = time.perf_counter()
    logits, _ = state['toxicity'].run([t[:4000] for t in body.texts])
    probs = 1 / (1 + np.exp(-logits))
    results = []
    for row in probs:
        scores = {label: round(float(p), 4) for label, p in zip(state['labels'], row)}
        level, categories = level_of(scores)
        results.append({'level': level, 'categories': categories, 'scores': scores})
    return {'model': models.MODELS['toxicity']['source'], 'ms': round((time.perf_counter() - t0) * 1000, 1), 'results': results}


def embed_vectors(enc: Encoder, texts: list[str], kind: str) -> np.ndarray:
    """bge: queries get the retrieval instruction, passages are embedded as they are; CLS pooling, L2-normalised."""
    prefix = 'Represent this sentence for searching relevant passages: ' if kind == 'query' else ''
    hidden, _ = enc.run([prefix + t[:4000] for t in texts])
    cls = hidden[:, 0, :]
    return cls / np.linalg.norm(cls, axis=1, keepdims=True)


@app.post('/embed')
def embed(body: Texts, x_alt_service_key: str | None = Header(default=None)):
    guard(x_alt_service_key)
    t0 = time.perf_counter()
    vectors = embed_vectors(state['embeddings'], body.texts, body.kind)
    return {'model': models.MODELS['embeddings']['source'], 'dim': int(vectors.shape[1]),
            'ms': round((time.perf_counter() - t0) * 1000, 1), 'vectors': [[round(float(x), 6) for x in v] for v in vectors]}


# ---------------------------------------------------------------- abnormal behaviour (Module 16 FE-3)

class Behaviour(BaseModel):
    features: list[str] = Field(min_length=1, max_length=40)
    train: list[list[float]] = Field(min_length=1, max_length=50_000)  # recent active days of every account
    score: list[list[float]] = Field(min_length=1, max_length=50_000)  # each account's last 24 hours
    seed: int = 42


def detect(train: np.ndarray, score: np.ndarray, seed: int = 42, rate: float = 0.005):
    """Two checks learned from the training rows (recent active days of every account), on log1p counts:
    - an Isolation Forest (Liu et al., 2008): unusual combinations (score: higher = more unusual, ~0.5 ordinary);
    - extremeness: how far the most extreme feature is above normal, (x - median) / (90th percentile - median),
      for attacks that differ in one or two features only, which the forest misses among many rare events.
    Each threshold is the (1 - rate) quantile of the training rows, so about 2 x rate of ordinary days are flagged."""
    from sklearn.ensemble import IsolationForest
    tr, sc = np.log1p(np.maximum(train, 0)), np.log1p(np.maximum(score, 0))
    forest = IsolationForest(n_estimators=200, max_samples=min(256, len(tr)), random_state=seed).fit(tr)
    median = np.median(tr, axis=0)
    spread = np.percentile(tr, 90, axis=0) - median
    spread = np.where(spread > 0, spread, np.maximum(np.std(tr, axis=0), 0.5))
    s_tr, s_sc = -forest.score_samples(tr), -forest.score_samples(sc)
    z_tr, z_sc = (tr - median) / spread, (sc - median) / spread
    t_forest = float(np.quantile(s_tr, 1 - rate))
    t_extreme = float(np.quantile(z_tr.max(axis=1), 1 - rate))
    flag = (s_sc >= t_forest) | (z_sc.max(axis=1) >= t_extreme)
    return {'scores': s_sc, 'z': z_sc, 'extreme': z_sc.max(axis=1), 'flag': flag,
            'forest_flag': s_sc >= t_forest, 'extreme_flag': z_sc.max(axis=1) >= t_extreme,
            'thresholds': {'forest': round(t_forest, 4), 'extreme': round(t_extreme, 4)}}


@app.post('/anomaly')
def anomaly(body: Behaviour, x_alt_service_key: str | None = Header(default=None)):
    guard(x_alt_service_key)
    n = len(body.features)
    if any(len(r) != n for r in body.train + body.score):
        raise HTTPException(status_code=422, detail='every row needs one value per feature')
    t0 = time.perf_counter()
    d = detect(np.array(body.train, dtype=float), np.array(body.score, dtype=float), body.seed)
    reasons = [[body.features[j] for j in np.argsort(-row)[:3] if row[j] > 1] for row in d['z']]
    return {'model': 'IsolationForest (scikit-learn, 200 trees) + per-feature extremeness', 'trained_rows': len(body.train),
            'thresholds': d['thresholds'], 'ms': round((time.perf_counter() - t0) * 1000, 1),
            'results': [{'score': round(float(s), 4), 'extreme': round(float(e), 3), 'unusual': bool(f), 'reasons': r}
                        for s, e, f, r in zip(d['scores'], d['extreme'], d['flag'], reasons)]}
