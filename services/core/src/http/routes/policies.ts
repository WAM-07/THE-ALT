import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Ctx } from '../../context.js';
import { tx } from '../../db.js';
import { audit } from '../../lib/audit.js';
import { conflict, forbidden, notFound } from '../../lib/errors.js';
import { NOTIFICATIONS_CHANNEL } from '../../lib/notify.js';
import { requireStaff, requireUser } from '../auth-guard.js';

const SLUGS = ['terms', 'privacy', 'ai-content'] as const;
const Slug = z.enum(SLUGS);

interface PolicyRow {
  slug: string;
  version: number;
  title: string;
  summary: string;
  body: string;
  published_at: Date;
  published_by: string | null;
  publisher_handle?: string | null;
}

const head = (p: PolicyRow) => ({
  slug: p.slug,
  version: p.version,
  title: p.title,
  summary: p.summary,
  publishedAt: p.published_at.toISOString(),
  publishedBy: p.published_by ? (p.publisher_handle ? `@${p.publisher_handle}` : 'ALT staff') : 'ALT',
});
const full = (p: PolicyRow) => ({ ...head(p), body: p.body });

const LATEST = `SELECT DISTINCT ON (p.slug) p.*, u.handle AS publisher_handle FROM core.policies p
                  LEFT JOIN core.users u ON u.id = p.published_by ORDER BY p.slug, p.version DESC`;

/** M3 FE-5: ALT's ecosystem-wide policies, versioned, and who accepted which version. */
export async function policyRoutes(app: FastifyInstance, ctx: Ctx) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const authed = requireUser(ctx);
  const staff = requireStaff(ctx);

  // ---------------------------------------------------------------- anyone

  r.get('/policies', { schema: { tags: ['policies'], summary: 'The current version of each ALT policy' } }, async () => {
    const { rows } = await ctx.db.query<PolicyRow>(LATEST);
    return { items: rows.map(head) };
  });

  r.get(
    '/policies/:slug',
    { schema: { tags: ['policies'], summary: 'A policy (the current version, or ?version=n)', params: z.object({ slug: Slug }), querystring: z.object({ version: z.coerce.number().int().min(1).optional() }) } },
    async (req) => {
      const { rows } = await ctx.db.query<PolicyRow>(
        `SELECT p.*, u.handle AS publisher_handle FROM core.policies p LEFT JOIN core.users u ON u.id = p.published_by
          WHERE p.slug = $1 AND ($2::int IS NULL OR p.version = $2) ORDER BY p.version DESC LIMIT 1`,
        [req.params.slug, req.query.version ?? null],
      );
      if (!rows[0]) throw notFound('Policy version');
      const { rows: versions } = await ctx.db.query<PolicyRow>('SELECT * FROM core.policies WHERE slug = $1 ORDER BY version DESC', [req.params.slug]);
      return { ...full(rows[0]), versions: versions.map((v) => ({ version: v.version, summary: v.summary, publishedAt: v.published_at.toISOString() })) };
    },
  );

  // ---------------------------------------------------------------- the signed-in person

  async function mine(userId: string) {
    const { rows } = await ctx.db.query<PolicyRow & { accepted_version: number | null }>(
      `SELECT l.*, (SELECT max(a.version) FROM core.policy_acceptances a WHERE a.user_id = $1 AND a.slug = l.slug) AS accepted_version
         FROM (${LATEST}) l`,
      [userId],
    );
    const items = rows.map((p) => ({ ...head(p), acceptedVersion: p.accepted_version, accepted: p.accepted_version === p.version }));
    return { items, pending: items.filter((p) => !p.accepted) };
  }

  r.get('/me/policies', { preHandler: authed, schema: { tags: ['policies'], summary: 'Which current policies you have accepted; `pending` lists the ones to agree to' } }, async (req) =>
    mine(req.auth!.userId),
  );

  r.post(
    '/me/policies/accept',
    { preHandler: authed, schema: { tags: ['policies'], summary: 'Agree to the current version of a policy', body: z.object({ slug: Slug, version: z.number().int().min(1) }) } },
    async (req) => {
      const a = req.auth!;
      await tx(ctx.db, async (client) => {
        const { rows } = await client.query<{ version: number }>('SELECT max(version) AS version FROM core.policies WHERE slug = $1', [req.body.slug]);
        // Only the current version can be agreed to: an old one might be what changed.
        if (rows[0]?.version !== req.body.version) throw conflict('NOT_CURRENT_VERSION', 'That is not the current version of this policy. Reload it and read it again.');
        const ins = await client.query(
          'INSERT INTO core.policy_acceptances (user_id, slug, version, platform) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
          [a.userId, req.body.slug, req.body.version, a.platform],
        );
        if (ins.rowCount) {
          await audit(client, { action: 'policy.accepted', actorUserId: a.userId, entityType: 'policy', entityId: `${req.body.slug}@${req.body.version}`, ip: req.ip, data: { platform: a.platform } });
        }
      });
      return mine(a.userId);
    },
  );

  // ---------------------------------------------------------------- the Command Centre

  r.get('/staff/policies', { preHandler: staff, schema: { tags: ['staff'], summary: 'Each policy, its versions and how many people accepted the current one' } }, async () => {
    const { rows } = await ctx.db.query<PolicyRow & { accepted: string }>(
      `SELECT l.*, (SELECT count(*) FROM core.policy_acceptances a WHERE a.slug = l.slug AND a.version = l.version) AS accepted FROM (${LATEST}) l`,
    );
    const { rows: people } = await ctx.db.query<{ n: string }>('SELECT count(*) AS n FROM core.users WHERE deleted_at IS NULL');
    const { rows: versions } = await ctx.db.query<PolicyRow & { publisher_handle: string | null; accepted: string }>(
      `SELECT p.*, u.handle AS publisher_handle, (SELECT count(*) FROM core.policy_acceptances a WHERE a.slug = p.slug AND a.version = p.version) AS accepted
         FROM core.policies p LEFT JOIN core.users u ON u.id = p.published_by ORDER BY p.slug, p.version DESC`,
    );
    return {
      people: Number(people[0]?.n ?? 0),
      items: rows.map((p) => ({
        ...full(p),
        accepted: Number(p.accepted),
        versions: versions.filter((v) => v.slug === p.slug).map((v) => ({ ...head(v), accepted: Number(v.accepted) })),
      })),
    };
  });

  r.post(
    '/staff/policies/:slug',
    {
      preHandler: staff,
      schema: {
        tags: ['staff'],
        summary: 'Publish a new version of a policy (admins). Everyone is asked to agree to it, in every app.',
        params: z.object({ slug: Slug }),
        body: z.object({
          title: z.string().trim().min(3).max(120),
          summary: z.string().trim().min(3).max(500),
          body: z.string().trim().min(20).max(50_000),
        }),
      },
    },
    async (req, reply) => {
      if (!req.auth!.roles.includes('admin')) throw forbidden('ADMINS_ONLY', 'Only admins publish policies.');
      const p = await tx(ctx.db, async (client) => {
        // One publisher at a time per policy, so two versions can't get the same number.
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`policy:${req.params.slug}`]);
        const { rows } = await client.query<PolicyRow>(
          `INSERT INTO core.policies (slug, version, title, summary, body, published_by)
           SELECT $1, COALESCE(max(version), 0) + 1, $2, $3, $4, $5 FROM core.policies WHERE slug = $1 RETURNING *`,
          [req.params.slug, req.body.title, req.body.summary, req.body.body, req.auth!.userId],
        );
        const row = rows[0]!;
        await audit(client, { action: 'policy.published', actorUserId: req.auth!.userId, entityType: 'policy', entityId: `${row.slug}@${row.version}`, ip: req.ip, data: { title: row.title, summary: row.summary } });
        // Everyone hears about it in their ALT inbox; each app also asks them to agree before going on.
        const { rows: sent } = await client.query<{ id: string; user_id: string }>(
          `INSERT INTO core.notifications (user_id, category, type, title, body, data, platform, link)
           SELECT id, 'system', 'policy.updated', $1, $2, $3, 'admin', NULL FROM core.users WHERE deleted_at IS NULL RETURNING id, user_id`,
          [`We updated our ${row.title.toLowerCase()}`, row.summary, { slug: row.slug, version: row.version }],
        );
        for (const n of sent) await client.query('SELECT pg_notify($1, $2)', [NOTIFICATIONS_CHANNEL, JSON.stringify({ id: n.id, userId: n.user_id })]);
        return row;
      });
      return reply.status(201).send(full(p));
    },
  );
}
