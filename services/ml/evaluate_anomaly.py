"""Evaluates ALT's abnormal-behaviour detector (Module 16 FE-3) on SIMULATED account activity.

ALT has no labelled record of real abuse, so this measures the method, not ALT's live data: a simulated population of
ordinary accounts (each with its own activity rates, 30 days of active days) and simulated attacks of six kinds, at
two strengths (obvious and subtle). The detector is exactly the service's code (app.detect): an Isolation Forest
and a per-feature extremeness check, both learned from the population's days (with 0.5% unlabelled attack days mixed
in, as real logs would have), then scoring a new day of every account plus the attacks. Each part is reported alone,
and against a hand-written rules baseline.

    python evaluate_anomaly.py      (from services/ml, in its virtualenv)

Writes docs/report-log/results/anomaly-eval.json and prints the tables recorded in docs/report-log/ml-models.md.
"""
import json
from pathlib import Path

import numpy as np
from sklearn.metrics import roc_auc_score

import app

SEED = 42
USERS, DAYS, PER_ATTACK = 2000, 30, 50
# The same features, in the same order, as ALT Core sends (services/core/src/modules/accounts/anomaly.ts).
FEATURES = ['sign_ins', 'failed_sign_ins', 'lockouts', 'distinct_ips', 'sessions_revoked', 'password_changes',
            'wallet_actions', 'ai_messages', 'flagged_messages', 'items_added', 'items_deleted', 'market_actions']
F = {n: i for i, n in enumerate(FEATURES)}
rng = np.random.default_rng(SEED)


def ordinary_days(n_users, days):
    """Simulated ordinary accounts: each has its own rates; only the days they were active are kept."""
    rows = []
    for _ in range(n_users):
        active = rng.beta(2, 3)
        r_msg = rng.lognormal(1.8, 0.9)  # about 6 messages to their AI on an active day, widely spread
        r_sign = rng.lognormal(0.0, 0.5)
        r_wallet, r_items, r_market = rng.lognormal(-2.5, 1), rng.lognormal(-1.5, 1), rng.lognormal(-3, 1)
        for _ in range(days):
            if rng.random() > active:
                continue
            d = np.zeros(len(FEATURES))
            d[F['sign_ins']] = rng.poisson(r_sign)
            d[F['failed_sign_ins']] = rng.poisson(0.15)
            d[F['lockouts']] = rng.random() < 0.002
            d[F['distinct_ips']] = 1 + (rng.random() < 0.2) + (rng.random() < 0.03)
            d[F['sessions_revoked']] = rng.poisson(0.05)
            d[F['password_changes']] = rng.random() < 0.01
            d[F['wallet_actions']] = rng.poisson(r_wallet)
            d[F['ai_messages']] = rng.poisson(r_msg)
            d[F['flagged_messages']] = rng.binomial(int(d[F['ai_messages']]), 0.005)
            d[F['items_added']] = rng.poisson(r_items)
            d[F['items_deleted']] = rng.poisson(r_items * 0.2)
            d[F['market_actions']] = rng.poisson(r_market)
            rows.append(d)
    return np.array(rows)


def attack(kind, subtle):
    """One simulated attack day on top of an ordinary day."""
    d = ordinary_days(1, 1)
    d = d[0] if len(d) else np.zeros(len(FEATURES))
    k = 0.15 if subtle else 1.0
    u = lambda lo, hi: rng.integers(max(1, int(lo * k)), max(2, int(hi * k)) + 1)
    if kind == 'credential stuffing':
        d[F['failed_sign_ins']] += u(20, 300); d[F['distinct_ips']] += u(5, 60); d[F['lockouts']] += rng.integers(1, 4)
    elif kind == 'account takeover':
        d[F['sign_ins']] += u(2, 8); d[F['distinct_ips']] += u(3, 10); d[F['password_changes']] += 1
        d[F['sessions_revoked']] += u(2, 10); d[F['wallet_actions']] += u(3, 15)
    elif kind == 'spam bot':
        d[F['ai_messages']] += u(300, 3000); d[F['flagged_messages']] += u(5, 100)
    elif kind == 'harassment':
        d[F['ai_messages']] += u(10, 60); d[F['flagged_messages']] += u(5, 30)
    elif kind == 'data dumping':
        d[F['items_added']] += u(30, 300); d[F['items_deleted']] += u(20, 300)
    elif kind == 'market abuse':
        d[F['market_actions']] += u(20, 100); d[F['wallet_actions']] += u(10, 50)
    return d


KINDS = ['credential stuffing', 'account takeover', 'spam bot', 'harassment', 'data dumping', 'market abuse']


def rules(rows):
    """A hand-written baseline: the thresholds a developer would pick first."""
    return ((rows[:, F['failed_sign_ins']] >= 10) | (rows[:, F['ai_messages']] >= 500) | (rows[:, F['flagged_messages']] >= 10)).astype(float)


def main():
    train = ordinary_days(USERS, DAYS)
    hidden = np.array([attack(rng.choice(KINDS), rng.random() < 0.5) for _ in range(int(len(train) * 0.005))])
    train = np.vstack([train, hidden])
    normal = ordinary_days(USERS, 1)
    attacks = {(k, s): np.array([attack(k, s) for _ in range(PER_ATTACK)]) for k in KINDS for s in (False, True)}
    test = np.vstack([normal] + list(attacks.values()))
    y = np.array([0] * len(normal) + [1] * (len(test) - len(normal)))

    d = app.detect(train, test, SEED)
    scores, flagged = d['scores'], d['flag']
    rule = rules(test)
    rows_n = len(normal)

    def at(pred):
        tp = int((pred & (y == 1)).sum()); fp = int((pred & (y == 0)).sum())
        return {'precision': round(tp / max(tp + fp, 1), 4), 'recall': round(tp / int((y == 1).sum()), 4),
                'false_positive_rate': round(fp / rows_n, 4)}

    per_kind, start = {}, rows_n
    for (k, s), a in attacks.items():
        part = slice(start, start + len(a)); start += len(a)
        per_kind[f'{k} ({"subtle" if s else "obvious"})'] = {
            'detector': round(float(flagged[part].mean()), 3), 'forest alone': round(float(d['forest_flag'][part].mean()), 3),
            'extremeness alone': round(float(d['extreme_flag'][part].mean()), 3), 'rules': round(float(rule[part].mean()), 3)}
    results = {
        'data': 'SIMULATED: ordinary accounts and attacks generated by this script (no real ALT data)',
        'features': FEATURES, 'train_rows': len(train), 'hidden_attack_rows_in_train': len(hidden),
        'test': {'ordinary': rows_n, 'attacks': int((y == 1).sum())},
        'thresholds': {'rule': 'each part: the 99.5th percentile of the training rows', **d['thresholds']},
        'auc': {'forest score': round(float(roc_auc_score(y, scores)), 4), 'extremeness': round(float(roc_auc_score(y, d['extreme'])), 4)},
        'detector (forest or extremeness)': at(flagged), 'forest alone': at(d['forest_flag']),
        'extremeness alone': at(d['extreme_flag']), 'rules baseline': at(rule.astype(bool)),
        'detection_by_attack': per_kind,
    }
    print(json.dumps(results, indent=2))
    out = Path(__file__).resolve().parents[2] / 'docs' / 'report-log' / 'results' / 'anomaly-eval.json'
    out.write_text(json.dumps(results, indent=2) + '\n')
    print('wrote', out)


if __name__ == '__main__':
    main()
