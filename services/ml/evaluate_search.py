"""Evaluates semantic search against ALT's BM25 on SciFact (Wadden et al., 2020), a public retrieval benchmark
from BEIR (Thakur et al., 2021): 5,183 scientific abstracts, and claims whose supporting abstracts are known.
From the Hugging Face hub (BeIR/scifact and BeIR/scifact-qrels, pinned revisions; CC BY-SA 4.0).

Three rankings, each scoring every abstract for every claim:
  BM25     ALT's word ranking (a port of terms() and bm25() in services/core/src/modules/ai/repo.ts)
  meaning  cosine similarity of the embedding model's vectors (exactly the service's embed code)
  hybrid   meaning + w * BM25 / best BM25, as retrieveSemantic() does; w is chosen on the train claims only
Metrics on the test claims: nDCG@10 (BEIR's main measure), Recall@10 and MRR@10.

    python evaluate_search.py      (from services/ml, in its virtualenv, with pyarrow installed)

Writes docs/report-log/results/search-eval.json and prints the tables recorded in docs/report-log/ml-models.md.
"""
import csv
import io
import json
import math
import re
import time
import urllib.request
from collections import Counter
from pathlib import Path

import numpy as np
import pyarrow.parquet as pq

import app  # the service's own model code, so the evaluation measures exactly what ALT runs

DATA = ('BeIR/scifact', 'b3b5335604bf5ee3c4447671af975ea25143d4f5')
QRELS = ('BeIR/scifact-qrels', '2938d17dc3b09882fdb8c12bbbe2e2dc0e75a029')
WEIGHTS = [0.0, 0.1, 0.2, 0.3, 0.5, 0.75, 1.0]
K = 10

STOP = set('''the and you your are for with that this what have was not but can how about from they their there them
will would should could into than then also just like when where which who why all any one our out has had his her
she him its'''.split())


def terms(s: str):
    """ALT's terms(): words of 3+ letters or digits, lower-cased, stop words dropped, lightly stemmed."""
    out = []
    for w in re.findall(r'[^\W_]{3,}', s.lower()):
        if w in STOP:
            continue
        if len(w) > 5 and w.endswith('ing'): w = w[:-3]
        elif len(w) > 4 and w.endswith('ies'): w = w[:-3] + 'y'
        elif len(w) > 4 and w.endswith('ed'): w = w[:-2]
        elif len(w) > 3 and w.endswith('s') and not w.endswith('ss'): w = w[:-1]
        out.append(w)
    return out


class Bm25:
    """ALT's bm25() (k1 1.2, b 0.75, idf log(1 + (N - df + 0.5) / (df + 0.5))), indexed once for speed."""

    def __init__(self, docs):
        self.tf = [Counter(terms(d)) for d in docs]
        self.len = np.array([sum(c.values()) for c in self.tf], dtype=float)
        self.avg = self.len.mean() or 1.0
        self.df = Counter(t for c in self.tf for t in c)
        self.post = {}
        for i, c in enumerate(self.tf):
            for t, f in c.items():
                self.post.setdefault(t, []).append((i, f))

    def scores(self, query):
        n, s = len(self.tf), np.zeros(len(self.tf))
        for t in set(terms(query)):
            df = self.df.get(t, 0)
            idf = math.log(1 + (n - df + 0.5) / (df + 0.5))
            for i, f in self.post.get(t, []):
                s[i] += idf * f * 2.2 / (f + 1.2 * (0.25 + 0.75 * self.len[i] / self.avg))
        return s


def fetch(repo, rev, path):
    return urllib.request.urlopen(f'https://huggingface.co/datasets/{repo}/resolve/{rev}/{path}', timeout=180).read()


def metrics(ranked, relevant):
    """nDCG@10 (binary gains, as SciFact's), Recall@10 and MRR@10, averaged over claims."""
    nd, rec, rr = [], [], []
    for qid, order in ranked.items():
        rel = relevant[qid]
        top = order[:K]
        dcg = sum(1 / math.log2(r + 2) for r, d in enumerate(top) if d in rel)
        ideal = sum(1 / math.log2(r + 2) for r in range(min(len(rel), K)))
        nd.append(dcg / ideal)
        rec.append(len([d for d in top if d in rel]) / len(rel))
        rr.append(next((1 / (r + 1) for r, d in enumerate(top) if d in rel), 0.0))
    return {'ndcg@10': round(float(np.mean(nd)), 4), 'recall@10': round(float(np.mean(rec)), 4), 'mrr@10': round(float(np.mean(rr)), 4)}


def main():
    corpus = pq.read_table(io.BytesIO(fetch(*DATA, 'corpus/corpus-00000-of-00001.parquet'))).to_pylist()
    queries = {q['_id']: q['text'] for q in pq.read_table(io.BytesIO(fetch(*DATA, 'queries/queries-00000-of-00001.parquet'))).to_pylist()}
    qrels = {}
    for split in ('train', 'test'):
        rel = {}
        for row in csv.DictReader(io.StringIO(fetch(*QRELS, f'{split}.tsv').decode()), delimiter='\t'):
            if int(row['score']) > 0:
                rel.setdefault(row['query-id'], set()).add(row['corpus-id'])
        qrels[split] = rel
    ids = [d['_id'] for d in corpus]
    docs = [f"{d['title']}: {d['text']}" for d in corpus]  # as ALT's passages are written ("Title: text")
    print(f'{len(docs)} abstracts, {len(qrels["train"])} train claims, {len(qrels["test"])} test claims')

    bm = Bm25(docs)
    enc = app.Encoder('embeddings')
    t0 = time.perf_counter()
    dv = np.vstack([app.embed_vectors(enc, docs[i:i + 32], 'passage') for i in range(0, len(docs), 32)])
    per_doc_ms = (time.perf_counter() - t0) * 1000 / len(docs)
    print(f'embedded the abstracts: {per_doc_ms:.1f} ms each')

    def rank(split, w):
        rel = qrels[split]
        qids = list(rel)
        qv = np.vstack([app.embed_vectors(enc, [queries[q] for q in qids[i:i + 32]], 'query') for i in range(0, len(qids), 32)])
        out = {}
        for qi, q in enumerate(qids):
            meaning = dv @ qv[qi]
            words = bm.scores(queries[q])
            top = words.max()
            if w is None:  # BM25 alone
                s = words
            else:
                s = meaning + (w * words / top if top > 0 else 0)
            out[q] = [ids[i] for i in np.argsort(-s)[:K]]
        return out, rel

    results = {'dataset': 'SciFact (BEIR)', 'revision': {DATA[0]: DATA[1], QRELS[0]: QRELS[1]}, 'abstracts': len(docs),
               'model': app.models.MODELS['embeddings']['source'], 'embed_ms_per_abstract': round(per_doc_ms, 1)}
    sweep = {}
    for w in WEIGHTS:
        sweep[w] = metrics(*rank('train', w))
        print(f'train  w={w:<5} {sweep[w]}')
    best = max(WEIGHTS, key=lambda w: sweep[w]['ndcg@10'])
    results['train_sweep'] = {str(w): m for w, m in sweep.items()}
    results['chosen_weight'] = best
    results['test'] = {
        'bm25 (ALT before)': metrics(*rank('test', None)),
        'meaning (embeddings)': metrics(*rank('test', 0.0)),
        f'hybrid (w={best}, chosen on train; ALT uses it)': metrics(*rank('test', best)),
        'hybrid (w=0.3, first guess)': metrics(*rank('test', 0.3)),
    }
    for name, m in results['test'].items():
        print(f'test   {name:<36} {m}')
    out = Path(__file__).resolve().parents[2] / 'docs' / 'report-log' / 'results' / 'search-eval.json'
    out.write_text(json.dumps(results, indent=2))
    print('wrote', out)


if __name__ == '__main__':
    main()
