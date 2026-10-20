import type { Ctx } from '../../context.js';
import { tx } from '../../db.js';
import { audit } from '../../lib/audit.js';
import { fileCase } from '../cases/cases.js';

/**
 * Abnormal-behaviour detection (Module 16 FE-3). Once a day, every account's activity in the last 24 hours is
 * compared with what ALT's accounts did on their active days over the 30 days before, by ALT's ML service (an
 * Isolation Forest plus a per-feature extremeness check, retrained on every scan; evaluated in
 * services/ml/evaluate_anomaly.py). Unusual accounts become "flag" cases for staff in the Command Centre; nothing
 * happens to the account itself. The counts come from ALT Core's audit log and chat messages only.
 */
export const BEHAVIOUR_FEATURES = [
  'sign_ins', 'failed_sign_ins', 'lockouts', 'distinct_ips', 'sessions_revoked', 'password_changes',
  'wallet_actions', 'ai_messages', 'flagged_messages', 'items_added', 'items_deleted', 'market_actions',
] as const;
// Fewer active days than this in the 30-day window and there is no "normal" to learn yet; the scan says so.
export const MIN_TRAINING_DAYS = 50;
const KEEP_RESULTS = 50;

const FEATURE_LABELS: Record<string, string> = {
  sign_ins: 'sign-ins', failed_sign_ins: 'failed sign-ins', lockouts: 'lockouts', distinct_ips: 'different IP addresses',
  sessions_revoked: 'sessions ended', password_changes: 'password changes', wallet_actions: 'wallet actions',
  ai_messages: 'messages to AIs', flagged_messages: 'flagged messages', items_added: 'items added',
  items_deleted: 'items deleted', market_actions: 'rentals, subscriptions and purchases',
};

/** Counts per account per bucket ('day' for learning, 'window' for the last 24 hours) between two times. */
async function activity(ctx: Ctx, from: Date, to: Date, bucket: 'day' | 'window') {
  const b = (col: string) => (bucket === 'day' ? `date_trunc('day', ${col})` : `NULL::timestamptz`);
  const { rows } = await ctx.db.query<Record<string, string> & { user_id: string }>(
    `WITH a AS (
       SELECT actor_user_id AS user_id, ${b('occurred_at')} AS bucket,
              count(*) FILTER (WHERE action = 'auth.session.started') AS sign_ins,
              count(*) FILTER (WHERE action = 'auth.login.failed') AS failed_sign_ins,
              count(*) FILTER (WHERE action = 'auth.lockout') AS lockouts,
              count(DISTINCT ip) AS distinct_ips,
              count(*) FILTER (WHERE action IN ('auth.session.revoked', 'auth.session.reuse_detected', 'auth.logout_all')) AS sessions_revoked,
              count(*) FILTER (WHERE action IN ('account.password_changed', 'account.password_reset')) AS password_changes,
              count(*) FILTER (WHERE action LIKE 'wallet.%' AND action <> 'wallet.starter_funds') AS wallet_actions,
              count(*) FILTER (WHERE action = 'dataset.added') AS items_added,
              count(*) FILTER (WHERE action = 'dataset.deleted') AS items_deleted,
              count(*) FILTER (WHERE action IN ('ai.rented', 'ai.subscribed')) AS market_actions
         FROM core.audit_log
        WHERE actor_user_id IS NOT NULL AND occurred_at >= $1 AND occurred_at < $2
        GROUP BY 1, 2),
     m AS (
       SELECT s.user_id, ${b('m.created_at')} AS bucket, count(*) AS ai_messages, count(*) FILTER (WHERE m.flagged) AS flagged_messages
         FROM core.chat_messages m JOIN core.chat_sessions s ON s.id = m.session_id
        WHERE m.role = 'user' AND m.created_at >= $1 AND m.created_at < $2
        GROUP BY 1, 2)
     SELECT COALESCE(a.user_id, m.user_id) AS user_id, a.sign_ins, a.failed_sign_ins, a.lockouts, a.distinct_ips,
            a.sessions_revoked, a.password_changes, a.wallet_actions, m.ai_messages, m.flagged_messages,
            a.items_added, a.items_deleted, a.market_actions
       FROM a FULL JOIN m ON a.user_id = m.user_id AND a.bucket IS NOT DISTINCT FROM m.bucket`,
    [from, to],
  );
  return rows.map((r) => ({ userId: r.user_id, vector: BEHAVIOUR_FEATURES.map((f) => Number(r[f] ?? 0)) }));
}

/** Runs one scan now: learns, judges the last 24 hours, files cases for unusual accounts, keeps the result. */
export async function scanBehaviour(ctx: Ctx, now = new Date(), minTrainingDays = MIN_TRAINING_DAYS) {
  const dayAgo = new Date(now.getTime() - 24 * 3600 * 1000);
  const monthAgo = new Date(now.getTime() - 31 * 24 * 3600 * 1000);
  const record = async (row: { status: string; model?: string | null; trained?: number; scored?: number; flagged?: number; thresholds?: unknown; results?: unknown[] }) => {
    const { rows } = await ctx.db.query<{ id: string }>(
      `INSERT INTO core.behaviour_scans (status, model, trained_rows, scored, flagged, thresholds, results) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [row.status, row.model ?? null, row.trained ?? 0, row.scored ?? 0, row.flagged ?? 0, row.thresholds ?? null, JSON.stringify(row.results ?? [])],
    );
    return { id: rows[0]!.id, ...row };
  };
  if (!ctx.ml?.anomaly) return record({ status: 'unavailable' });
  const [train, recent] = await Promise.all([activity(ctx, monthAgo, dayAgo, 'day'), activity(ctx, dayAgo, now, 'window')]);
  if (train.length < minTrainingDays || !recent.length) return record({ status: 'not_enough_data', trained: train.length, scored: recent.length });
  const run = await ctx.ml.anomaly([...BEHAVIOUR_FEATURES], train.map((r) => r.vector), recent.map((r) => r.vector));
  if (!run) return record({ status: 'unavailable', trained: train.length, scored: recent.length });

  const judged = recent
    .map((r, i) => ({ userId: r.userId, ...run.results[i]!, features: Object.fromEntries(BEHAVIOUR_FEATURES.map((f, j) => [f, r.vector[j]])) }))
    .sort((x, y) => Number(y.unusual) - Number(x.unusual) || y.score - x.score);
  const unusual = judged.filter((j) => j.unusual);
  const saved = await record({ status: 'done', model: run.model, trained: run.trained_rows, scored: recent.length, flagged: unusual.length, thresholds: run.thresholds, results: judged.slice(0, KEEP_RESULTS) });
  for (const u of unusual) {
    const why = u.reasons.map((r) => `${u.features[r]} ${FEATURE_LABELS[r] ?? r}`).join(', ');
    await tx(ctx.db, async (client) => {
      await fileCase(client, {
        kind: 'flag',
        platform: 'core',
        category: 'unusual_activity',
        title: 'Unusual account activity',
        body: `ALT's behaviour model found this account's last 24 hours unusual${why ? ` (${why})` : ''}. Automatic flag: check before acting.`,
        priority: 'normal',
        subject: { type: 'user', id: u.userId, userId: u.userId },
        evidence: { scanId: saved.id, score: u.score, extreme: u.extreme, reasons: u.reasons, features: u.features, thresholds: run.thresholds },
        service: 'ml',
      });
      await audit(client, { action: 'security.unusual_activity', actorService: 'core', entityType: 'user', entityId: u.userId, data: { scanId: saved.id, score: u.score, reasons: u.reasons } });
    });
  }
  return saved;
}

/** Runs the daily scan when the last one is a day old (one Core instance at a time). */
export async function scanIfDue(ctx: Ctx) {
  const client = await ctx.db.connect();
  try {
    const { rows } = await client.query<{ ok: boolean }>(`SELECT pg_try_advisory_lock(hashtext('core.behaviour_scan')) AS ok`);
    if (!rows[0]?.ok) return null;
    try {
      const { rows: last } = await client.query(`SELECT 1 FROM core.behaviour_scans WHERE ran_at > now() - interval '23 hours' LIMIT 1`);
      return last.length ? null : await scanBehaviour(ctx);
    } finally {
      await client.query(`SELECT pg_advisory_unlock(hashtext('core.behaviour_scan'))`);
    }
  } finally {
    client.release();
  }
}
