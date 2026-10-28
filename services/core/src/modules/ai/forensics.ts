import type { Ctx } from '../../context.js';

/**
 * Module 5 (forensics): how an AI behaved over time, for staff in the ALT Command Centre. Per day: replies,
 * replies moderation blocked and reply time; its health history; every version with its engine, readiness
 * and the owner's verdict; the cases about it; and the audit entries for it.
 */
export async function aiTimeline(ctx: Ctx, aiId: string, days = 30) {
  const { rows: ai } = await ctx.db.query(
    `SELECT a.id, a.name, a.handle, a.status, a.health_score, a.created_at, o.handle AS owner_handle, c.handle AS creator_handle
       FROM core.personal_ais a JOIN core.users o ON o.id = a.owner_id JOIN core.users c ON c.id = a.creator_id WHERE a.id = $1`,
    [aiId],
  );
  if (!ai[0]) return null;
  const [activity, health, versions, cases, audit] = await Promise.all([
    ctx.db.query(
      `SELECT d::date AS day, count(l.id)::int AS replies, count(l.id) FILTER (WHERE l.flagged)::int AS blocked,
              round(avg(l.latency_ms))::int AS avg_latency_ms
         FROM generate_series(date_trunc('day', now()) - make_interval(days => $2 - 1), date_trunc('day', now()), interval '1 day') d
         LEFT JOIN core.interaction_log l ON l.ai_id = $1 AND l.created_at >= d AND l.created_at < d + interval '1 day'
        GROUP BY d ORDER BY d`,
      [aiId, days],
    ),
    ctx.db.query(`SELECT score, components, computed_at FROM core.ai_health WHERE ai_id = $1 ORDER BY computed_at DESC LIMIT 60`, [aiId]),
    ctx.db.query(
      `SELECT version_no, engine, training_mode, readiness, owner_verdict, manifest_cid, created_at, published_at FROM core.ai_versions WHERE ai_id = $1 ORDER BY version_no`,
      [aiId],
    ),
    ctx.db.query(`SELECT id, kind, category, status, priority, title, created_at FROM core.cases WHERE subject_ai_id = $1 ORDER BY created_at DESC LIMIT 50`, [aiId]),
    ctx.db.query(`SELECT id, occurred_at, action, actor_service, data FROM core.audit_log WHERE entity_type = 'ai' AND entity_id = $1 ORDER BY id DESC LIMIT 100`, [aiId]),
  ]);
  const a = ai[0];
  return {
    ai: { id: a.id, name: a.name, handle: a.handle, status: a.status, healthScore: Number(a.health_score), owner: a.owner_handle, creator: a.creator_handle, createdAt: a.created_at.toISOString() },
    activity: activity.rows.map((r) => ({ day: (r.day as Date).toISOString().slice(0, 10), replies: r.replies, blocked: r.blocked, avgLatencyMs: r.avg_latency_ms })),
    health: health.rows.map((r) => ({ score: Number(r.score), parts: r.components.parts, at: (r.computed_at as Date).toISOString() })),
    versions: versions.rows.map((v) => ({
      version: v.version_no,
      engine: v.engine,
      training: v.training_mode,
      readiness: v.readiness === null ? null : Number(v.readiness),
      verdict: v.owner_verdict,
      manifestCid: v.manifest_cid,
      createdAt: (v.created_at as Date).toISOString(),
      publishedAt: v.published_at ? (v.published_at as Date).toISOString() : null,
    })),
    cases: cases.rows.map((c) => ({ id: c.id, kind: c.kind, category: c.category, status: c.status, priority: c.priority, title: c.title, createdAt: (c.created_at as Date).toISOString() })),
    audit: audit.rows.map((e) => ({ id: String(e.id), at: (e.occurred_at as Date).toISOString(), action: e.action, by: e.actor_service ?? 'person', data: e.data })),
  };
}

export async function searchAis(ctx: Ctx, q: string) {
  const { rows } = await ctx.db.query(
    `SELECT a.id, a.name, a.handle, a.status, a.health_score, a.is_demo, o.handle AS owner_handle
       FROM core.personal_ais a JOIN core.users o ON o.id = a.owner_id
      WHERE a.deleted_at IS NULL AND ($1 = '' OR a.handle ILIKE $2 OR a.name ILIKE $2)
      ORDER BY a.health_score ASC, a.created_at DESC LIMIT 200`,
    [q, `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`],
  );
  return rows.map((a) => ({ id: a.id, name: a.name, handle: a.handle, status: a.status, healthScore: Number(a.health_score), demo: a.is_demo, owner: a.owner_handle }));
}
