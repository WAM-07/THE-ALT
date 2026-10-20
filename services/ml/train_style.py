"""Trains and evaluates ALT's style-match baseline ("sounds like you", Modules 9 and 7): given a sample of how a
person writes (their profile) and a new text, how likely is it that the same person wrote it?

Model: logistic regression over (a) thirteen writing-style features, each as |text - profile mean| / scale, and
(b) the meaning similarity of the text to the profile (cosine of the embedding model's vectors, the service's own
embed code). Trained in seconds; ALT Core applies the exported weights (services/core/src/modules/ai/style.ts).

Data: the Blog Authorship Corpus (Schler et al., 2006; 681,288 posts by 19,320 bloggers, free for non-commercial
research), half of the Hugging Face copy (tasksource/blog_authorship_corpus, pinned revision), cached locally.
Bloggers with 30+ posts of 200-3,000 characters; 300 drawn (seed 42), split into 200 for training and 100 for
testing, so the test is on people the model never saw (as with a new ALT owner). Each blogger: a profile of 20
posts, 5 more of their posts (same author) and 5 posts by other bloggers in the same split (different author).
Posts are cut to their first CUT characters (ALT_STYLE_CUT, default 250), close to the length of chat messages;
ALT Core cuts texts the same way (the length is saved with the weights).

    python train_style.py      (from services/ml, in its virtualenv, with pyarrow installed)

Writes services/core/src/modules/ai/style-model.json (the weights ALT uses), services/core/test/style-features.json
(features of fixed texts, so Core's TypeScript port is checked against this code) and
docs/report-log/results/style-eval.json.
"""
import json
import os
import random
import re
import time
import urllib.request
from pathlib import Path

import numpy as np
import pyarrow.parquet as pq
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score, roc_curve

import app

REPO = 'tasksource/blog_authorship_corpus'
REV = '8d658f137b1844d28b533f67888a6d244f6cc28a'
URL = f'https://huggingface.co/api/datasets/{REPO}/parquet/default/train/0.parquet?revision={REV}'
SEED = 42
AUTHORS, TRAIN_AUTHORS, PROFILE, POSITIVE = 300, 200, 20, 5
CUT = int(os.environ.get('ALT_STYLE_CUT', '250'))
ROOT = Path(__file__).resolve().parents[2]

# ---------------------------------------------------------------- the thirteen features (ported exactly in style.ts)
WORD = re.compile(r"[^\W\d_]+(?:['’][^\W\d_]+)*")
LETTER = re.compile(r'[^\W\d_]')
SENTENCE_END = re.compile(r'[.!?…]+(?:\s+|$)|\n+')
EMOJI = re.compile('[\U0001F300-\U0001FAFF☀-➿]')
FIRST_PERSON = {'i', 'me', 'my', 'mine', 'myself', 'im', "i'm"}
FEATURES = ['word_length', 'sentence_length', 'commas', 'exclamations', 'questions', 'ellipses', 'emoji',
            'capitals', 'first_person', 'contractions', 'lowercase_starts', 'long_words', 'digits']


def features(t: str) -> list[float]:
    words = WORD.findall(t)
    w = max(len(words), 1)
    sentences = [s for s in SENTENCE_END.split(t) if LETTER.search(s)]
    s = max(len(sentences), 1)
    letters = sum(c.isalpha() for c in t)
    bare = [x.replace("'", '').replace('’', '') for x in words]
    return [
        sum(len(x) for x in bare) / w,
        len(words) / s,
        t.count(',') / w,
        t.count('!') / w,
        t.count('?') / w,
        len(re.findall(r'\.\.\.|…', t)) / w,
        len(EMOJI.findall(t)) / w,
        sum(c.isupper() for c in t) / max(letters, 1),
        sum(x.lower().replace('’', "'") in FIRST_PERSON for x in words) / w,
        sum(("'" in x) or ('’' in x) for x in words) / w,
        sum(LETTER.search(x).group().islower() for x in sentences) / s,
        sum(len(x) >= 7 for x in bare) / w,
        sum(c.isdecimal() for c in t) / max(len(t), 1),
    ]


FIXTURE = [
    'hey!! im so tired lol... going to sleep now 😴',
    "I've been thinking about the project. It's going well, but the deadline (March 3rd) is close. Thoughts?",
    'Assalam o alaikum! Kal class nahi hogi, sir ne bataya.\nPlease share with everyone.',
]


def pairs_features(profile_f, profile_v, text_f, text_v, scale):
    style = np.abs(np.asarray(text_f) - np.mean(profile_f, axis=0)) / scale
    centroid = np.mean(profile_v, axis=0)
    meaning = float(text_v @ (centroid / np.linalg.norm(centroid)))
    return list(style) + [meaning]


def eer(y, p):
    fpr, tpr, _ = roc_curve(y, p)
    i = np.nanargmin(np.abs(fpr - (1 - tpr)))
    return float((fpr[i] + 1 - tpr[i]) / 2)


def main():
    cache = Path(__file__).parent / '.data' / f'blog-{REV[:12]}-0.parquet'
    if not cache.exists():
        cache.parent.mkdir(parents=True, exist_ok=True)
        print('downloading the Blog Authorship Corpus (half, 300 MB, once)…')
        tmp = cache.with_suffix('.part')
        with urllib.request.urlopen(URL, timeout=600) as r, open(tmp, 'wb') as f:
            while chunk := r.read(1 << 22):
                f.write(chunk)
        tmp.replace(cache)
    table = pq.read_table(cache, columns=['id', 'text']).to_pydict()
    by_author: dict = {}
    for a, t in zip(table['id'], table['text']):
        t = re.sub(r'\s+', ' ', t or '').strip()
        if 200 <= len(t) <= 3000:
            by_author.setdefault(a, []).append(t[:CUT])
    eligible = sorted(a for a, p in by_author.items() if len(p) >= 30)
    rng = random.Random(SEED)
    authors = rng.sample(eligible, AUTHORS)
    print(f'{len(table["id"])} posts, {len(by_author)} bloggers, {len(eligible)} with 30+ posts; using {AUTHORS}')

    posts = {a: rng.sample(by_author[a], PROFILE + POSITIVE) for a in authors}
    enc = app.Encoder('embeddings')
    flat = [(a, i, t) for a in authors for i, t in enumerate(posts[a])]
    t0 = time.perf_counter()
    vecs = np.vstack([app.embed_vectors(enc, [x[2] for x in flat[i:i + 32]], 'passage') for i in range(0, len(flat), 32)])
    ms = (time.perf_counter() - t0) * 1000 / len(flat)
    print(f'embedded {len(flat)} posts: {ms:.1f} ms each')
    vec = {(a, i): vecs[k] for k, (a, i, _) in enumerate(flat)}
    feat = {(a, i): features(t) for a, i, t in flat}

    train, test = authors[:TRAIN_AUTHORS], authors[TRAIN_AUTHORS:]
    scale = np.std([feat[(a, i)] for a in train for i in range(PROFILE + POSITIVE)], axis=0) + 1e-6

    def build(group, profile_size=PROFILE):
        X, y = [], []
        for a in group:
            pf = [feat[(a, i)] for i in range(profile_size)]
            pv = [vec[(a, i)] for i in range(profile_size)]
            others = [b for b in group if b != a]
            for j in range(POSITIVE):
                X.append(pairs_features(pf, pv, feat[(a, PROFILE + j)], vec[(a, PROFILE + j)], scale)); y.append(1)
                b = rng.choice(others)
                X.append(pairs_features(pf, pv, feat[(b, PROFILE + j)], vec[(b, PROFILE + j)], scale)); y.append(0)
        return np.array(X), np.array(y)

    Xtr, ytr = build(train)
    Xte, yte = build(test)
    n = len(FEATURES)
    combined = LogisticRegression(max_iter=2000).fit(Xtr, ytr)
    style_only = LogisticRegression(max_iter=2000).fit(Xtr[:, :n], ytr)

    def report(p, y):
        return {'auc': round(float(roc_auc_score(y, p)), 4), 'accuracy@0.5': round(float(np.mean((p >= 0.5) == y)), 4), 'eer': round(eer(y, p), 4)}

    results = {
        'dataset': 'Blog Authorship Corpus (Schler et al., 2006)', 'revision': {REPO: REV},
        'bloggers': {'train': len(train), 'test': len(test)}, 'pairs': {'train': len(ytr), 'test': len(yte)},
        'profile_posts': PROFILE, 'chars_per_post': CUT, 'embed_ms_per_post': round(ms, 1),
        'test': {
            'style features only': report(style_only.predict_proba(Xte[:, :n])[:, 1], yte),
            'meaning only (cosine)': {'auc': round(float(roc_auc_score(yte, Xte[:, n])), 4)},
            'style + meaning (ALT uses it)': report(combined.predict_proba(Xte)[:, 1], yte),
        },
        'profile_size_test_auc': {},
    }
    for k in (3, 5, 10, 20):
        Xk, yk = build(test, k)
        results['profile_size_test_auc'][str(k)] = round(float(roc_auc_score(yk, combined.predict_proba(Xk)[:, 1])), 4)
    results['weights'] = dict(zip(FEATURES + ['meaning'], [round(float(c), 4) for c in combined.coef_[0]]))
    for name, m in results['test'].items():
        print(f'test  {name:<32} {m}')
    print('test AUC by profile size:', results['profile_size_test_auc'])

    model = {
        'about': 'ALT style match: logistic regression trained by services/ml/train_style.py on the Blog Authorship Corpus.',
        'chars': CUT,
        'features': FEATURES,
        'scale': [round(float(s), 6) for s in scale],
        'withMeaning': {'coef': [round(float(c), 6) for c in combined.coef_[0]], 'intercept': round(float(combined.intercept_[0]), 6)},
        'styleOnly': {'coef': [round(float(c), 6) for c in style_only.coef_[0]], 'intercept': round(float(style_only.intercept_[0]), 6)},
        'test': results['test'],
    }
    (ROOT / 'services/core/src/modules/ai/style-model.json').write_text(json.dumps(model, indent=2) + '\n')
    (ROOT / 'services/core/test/style-features.json').write_text(json.dumps([{'text': t, 'features': features(t)} for t in FIXTURE], indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    (ROOT / 'docs/report-log/results/style-eval.json').write_text(json.dumps(results, indent=2) + '\n')
    print('wrote style-model.json, style-features.json and style-eval.json')


if __name__ == '__main__':
    main()
