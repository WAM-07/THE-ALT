import type { Ctx } from '../../context.js';
import { tx } from '../../db.js';
import { audit } from '../../lib/audit.js';
import { notify } from '../../lib/notify.js';
import { loadAi, loadVersion } from './repo.js';

/**
 * Module 7: the AI Health Score, one number (0–100) for how well an AI behaves, from what ALT records:
 *  - safety:    the share of its replies moderation blocked (last 30 days); 20% blocked or more = 0
 *  - reports:   cases about it in the ALT Command Centre (last 90 days, dismissed ones excluded), −15 each
 *  - readiness: its live version's score on the owner's questions
 *  - rating:    its ALTAR rating (1–5 stars)
 *  - speed:     its median reply time (last 30 days); 2 s or less = 100, 15 s or more = 0
 * A part with no data yet is left out and the others are re-weighted. Drift (readiness lost since the
 * previous trained version) is subtracted. Weights are ALT's defaults (owner to confirm).
 */
export const HEALTH_WEIGHTS = { safety: 0.35, reports: 0.25, readiness: 0.2, rating: 0.1, speed: 0.1 } as const;
/** Below this the owner is told, once, in their ALT inbox. */
export const HEALTH_ALERT_BELOW = 60;

type Part = keyof typeof HEALTH_WEIGHTS;
export interface HealthComponents {
  parts: Record<Part, number | null>;
  drift: number;
  data: { replies: number; blocked: number; cases: number; reviews: number; avgRating: number | null; medianLatencyMs: number | null; readiness: number | null };
}

const clamp = (n: number) => Math.max(0, Math.min(100, n));
const r1 = (n: number) => Number(n.toFixed(1));

export async function computeHealth(ctx: Ctx, aiId: string): Promise<{ score: number; components: HealthComponents }> {
  const ai = await loadAi(ctx.db, aiId);
  if (!ai) throw new Error('AI not found');
  const [{ rows: log }, { rows: cases }, { rows: ratingView }] = await Promise.all([
    ctx.db.query<{ replies: string; blocked: string; median: number | null }>(
      `SELECT count(*) AS replies, count(*) FILTER (WHERE flagged) AS blocked,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) AS median
         FROM core.interaction_log WHERE ai_id = $1 AND created_at > now() - interval '30 days'`,
      [aiId],
    ),
    ctx.db.query<{ n: string }>(
      `SELECT count(*) AS n FROM core.cases WHERE subject_ai_id = $1 AND status <> 'dismissed' AND created_at > now() - interval '90 days'`,
      [aiId],
    ),
    ctx.db.query<{ present: boolean }>(`SELECT to_regclass('altar.ai_ratings') IS NOT NULL AS present`),
  ]);
  let avgRating: number | null = null;
  let reviews = 0;
  if (ratingView[0]?.present) {
    const { rows } = await ctx.db.query<{ avg_rating: string; reviews: number }>('SELECT avg_rating, reviews FROM altar.ai_ratings WHERE ai_id = $1', [aiId]);
    if (rows[0]) [avgRating, reviews] = [Number(rows[0].avg_rating), rows[0].reviews];
  }

  const current = ai.current_version_id ? await loadVersion(ctx.db, ai.current_version_id) : undefined;
  const readiness = current?.readiness == null ? null : Number(current.readiness);
  let drift = 0;
  if (current && readiness !== null) {
    const { rows } = await ctx.db.query<{ readiness: string }>(
      `SELECT readiness FROM core.ai_versions WHERE ai_id = $1 AND engine = 'adapter' AND readiness IS NOT NULL AND version_no < $2 ORDER BY version_no DESC LIMIT 1`,
      [aiId, current.version_no],
    );
    if (rows[0]) drift = Math.max(0, Number(rows[0].readiness) - readiness) / 2;
  }

  const replies = Number(log[0]?.replies ?? 0);
  const blocked = Number(log[0]?.blocked ?? 0);
  const median = log[0]?.median === null || log[0]?.median === undefined ? null : Number(log[0].median);
  const caseCount = Number(cases[0]?.n ?? 0);
  const parts: Record<Part, number | null> = {
    safety: replies ? clamp(100 * (1 - (blocked / replies) * 5)) : null,
    reports: clamp(100 - 15 * caseCount),
    readiness,
    rating: avgRating === null ? null : clamp(((avgRating - 1) / 4) * 100),
    speed: median === null ? null : clamp(100 - ((median - 2000) / 13_000) * 100),
  };
  let weight = 0;
  let sum = 0;
  for (const [k, w] of Object.entries(HEALTH_WEIGHTS) as [Part, number][]) {
    const v = parts[k];
    if (v === null) continue;
    weight += w;
    sum += w * v;
  }
  const score = r1(clamp((weight ? sum / weight : 100) - drift));
  return {
    score,
    components: {
      parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, v === null ? null : r1(v)])) as Record<Part, number | null>,
      drift: r1(drift),
      data: { replies, blocked, cases: caseCount, reviews, avgRating, medianLatencyMs: median === null ? null : Math.round(median), readiness },
    },
  };
}

/** Recomputes and saves an AI's score; tells the owner when it falls below the alert line, and ALTERA at once. */
export async function refreshHealth(ctx: Ctx, aiId: string) {
  const { score, components } = await computeHealth(ctx, aiId);
  return tx(ctx.db, async (client) => {
    const { rows } = await client.query<{ health_score: string; owner_id: string; name: string }>(
      'SELECT health_score, owner_id, name FROM core.personal_ais WHERE id = $1 FOR UPDATE',
      [aiId],
    );
    const before = Number(rows[0]!.health_score);
    await client.query('UPDATE core.personal_ais SET health_score = $2 WHERE id = $1', [aiId, score]);
    await client.query('INSERT INTO core.ai_health (ai_id, score, components) VALUES ($1, $2, $3)', [aiId, score, components]);
    if (Math.round(before) !== Math.round(score)) {
      await client.query(`SELECT pg_notify('alt_ai_events', $1)`, [JSON.stringify({ aiId, event: 'health' })]);
    }
    if (score < HEALTH_ALERT_BELOW && before >= HEALTH_ALERT_BELOW) {
      await audit(client, { action: 'ai.health_low', actorService: 'core', entityType: 'ai', entityId: aiId, data: { score, before } });
      await notify(client, {
        userId: rows[0]!.owner_id,
        category: 'ai',
        type: 'ai.health_low',
        title: `${rows[0]!.name}'s health fell to ${Math.round(score)}`,
        body: 'See what lowered it in ALTER, then train it again or review what it says.',
        data: { aiId, score, components },
        platform: 'alter',
        link: 'alter://training',
      });
    }
    return { score, before, components };
  });
}

/** Every live AI, once an hour (one Core instance at a time). */
export async function refreshAllHealth(ctx: Ctx) {
  const client = await ctx.db.connect();
  try {
    const { rows: lock } = await client.query<{ ok: boolean }>(`SELECT pg_try_advisory_lock(hashtext('core.health_scores')) AS ok`);
    if (!lock[0]?.ok) return 0;
    try {
      const { rows } = await client.query<{ id: string }>(`SELECT id FROM core.personal_ais WHERE status IN ('verified', 'suspended') AND deleted_at IS NULL`);
      for (const r of rows) await refreshHealth(ctx, r.id);
      return rows.length;
    } finally {
      await client.query(`SELECT pg_advisory_unlock(hashtext('core.health_scores'))`);
    }
  } finally {
    client.release();
  }
}

export function startHealthScores(ctx: Ctx, warn: (msg: string) => void) {
  const run = () => void refreshAllHealth(ctx).catch((err: Error) => warn(`health scores: ${err.message}`));
  const first = setTimeout(run, 90_000);
  const timer = setInterval(run, 3600_000);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}

export async function healthHistory(ctx: Ctx, aiId: string, limit = 30) {
  const { rows } = await ctx.db.query<{ score: string; computed_at: Date }>('SELECT score, computed_at FROM core.ai_health WHERE ai_id = $1 ORDER BY computed_at DESC LIMIT $2', [aiId, limit]);
  return rows.map((r) => ({ score: Number(r.score), at: r.computed_at.toISOString() }));
}
