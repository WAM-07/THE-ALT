import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { ALL_ROLES, type Ctx } from '../../context.js';
import { tx } from '../../db.js';
import { audit, verifyAuditChain } from '../../lib/audit.js';
import { notFound } from '../../lib/errors.js';
import { findUserByHandle, findUserById, handleTaken, parseRoles, publicProfile, type UserRow } from '../../modules/accounts/users.js';
import { BEHAVIOUR_FEATURES, MIN_TRAINING_DAYS, scanBehaviour } from '../../modules/accounts/behaviour.js';
import { aiTimeline, searchAis } from '../../modules/ai/forensics.js';
import { requireAnyRole, requireRole, requireService } from '../auth-guard.js';
import { Handle } from '../schemas.js';

const MEDIA_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

/** Public profile lookups, internal service lookups, admin tools, uploaded media and dev helpers. */
export async function directoryRoutes(app: FastifyInstance, ctx: Ctx) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/users/:handle',
    { schema: { tags: ['directory'], summary: 'Public profile of an ALT user', params: z.object({ handle: z.string().min(1).max(40) }) } },
    async (req) => {
      const user = await findUserByHandle(ctx.db, req.params.handle);
      if (!user) throw notFound('User');
      return publicProfile(ctx.db, user);
    },
  );

  r.get(
    '/handles/:handle/available',
    { schema: { tags: ['directory'], summary: 'Is this handle free?', params: z.object({ handle: Handle }) } },
    async (req) => ({ handle: req.params.handle, available: !(await handleTaken(ctx.db, req.params.handle)) }),
  );

  r.get('/media/*', { schema: { hide: true } }, async (req, reply) => {
    const rel = (req.params as Record<string, string>)['*'] ?? '';
    const root = path.resolve(ctx.config.storageDir);
    const file = path.resolve(root, rel);
    const type = MEDIA_TYPES[path.extname(file).toLowerCase()];
    if (!file.startsWith(root + path.sep) || !type) throw notFound('File');
    try {
      const info = await stat(file);
      if (!info.isFile()) throw new Error('not a file');
    } catch {
      throw notFound('File');
    }
    reply.header('cache-control', 'public, max-age=86400').type(type);
    return reply.send(createReadStream(file));
  });

  // ---------------------------------------------------------------- internal (service to service)

  r.post(
    '/internal/users/lookup',
    {
      preHandler: requireService(ctx),
      schema: {
        tags: ['internal'],
        summary: 'Bulk profile lookup for other ALT services',
        body: z.object({ ids: z.array(z.uuid()).max(200).optional(), handles: z.array(z.string()).max(200).optional() }),
      },
    },
    async (req) => {
      const { rows } = await ctx.db.query<UserRow>(
        `SELECT * FROM core.users WHERE deleted_at IS NULL AND (id = ANY($1::uuid[]) OR handle = ANY($2::citext[]))`,
        [req.body.ids ?? [], req.body.handles ?? []],
      );
      for (const row of rows) row.roles = parseRoles(row.roles);
      return Promise.all(rows.map((u) => publicProfile(ctx.db, u)));
    },
  );

  // ---------------------------------------------------------------- admin

  const admin = requireRole(ctx, 'admin');
  // Auditors read the audit log too (the ALT Command Centre's audit page); only admins change anything.
  const auditReader = requireAnyRole(ctx, ['admin', 'auditor']);
  const behaviourReader = requireAnyRole(ctx, ['admin', 'moderator', 'auditor']);

  // Demo AIs (owner, 2026-10-29): the demo story labels the AIs it creates.
  r.put(
    '/admin/ais/:id/demo',
    { preHandler: admin, schema: { tags: ['admin'], summary: 'Label an AI as made by the demo story (or not)', params: z.object({ id: z.uuid() }), body: z.object({ demo: z.boolean() }) } },
    async (req) => {
      return tx(ctx.db, async (client) => {
        const { rowCount } = await client.query('UPDATE core.personal_ais SET is_demo = $2 WHERE id = $1 AND deleted_at IS NULL', [req.params.id, req.body.demo]);
        if (!rowCount) throw notFound('AI');
        await audit(client, { action: 'ai.demo_label', actorUserId: req.auth!.userId, entityType: 'ai', entityId: req.params.id, ip: req.ip, data: { demo: req.body.demo } });
        await client.query(`SELECT pg_notify('alt_ai_events', $1)`, [JSON.stringify({ aiId: req.params.id, event: 'demo' })]);
        return { id: req.params.id, demo: req.body.demo };
      });
    },
  );

  // Module 5 forensics: AIs (least healthy first), and how one behaved over time.
  r.get(
    '/admin/ais',
    { preHandler: behaviourReader, schema: { tags: ['admin'], summary: 'Find AIs by handle or name, least healthy first', querystring: z.object({ q: z.string().trim().max(60).default('') }) } },
    async (req) => searchAis(ctx, req.query.q),
  );

  r.get(
    '/admin/ais/:id/timeline',
    {
      preHandler: behaviourReader,
      schema: { tags: ['admin'], summary: 'An AI over time: replies and blocks per day, health, versions, cases and audit entries', params: z.object({ id: z.uuid() }), querystring: z.object({ days: z.coerce.number().int().min(1).max(90).default(30) }) },
    },
    async (req) => {
      const timeline = await aiTimeline(ctx, req.params.id, req.query.days);
      if (!timeline) throw notFound('AI');
      return timeline;
    },
  );

  // Abnormal-behaviour scans (Module 16 FE-3): what ALT's behaviour model saw, newest first.
  r.get(
    '/admin/behaviour',
    { preHandler: behaviourReader, schema: { tags: ['admin'], summary: 'Abnormal-behaviour scans (behaviour model) and the accounts they found unusual' } },
    async () => {
      const { rows } = await ctx.db.query(`SELECT * FROM core.behaviour_scans ORDER BY ran_at DESC LIMIT 10`);
      const ids = [...new Set(rows.flatMap((s) => (s.results as { userId: string }[]).map((x) => x.userId)))];
      const { rows: people } = ids.length
        ? await ctx.db.query<{ id: string; handle: string; display_name: string }>('SELECT id, handle, display_name FROM core.users WHERE id = ANY($1::uuid[])', [ids])
        : { rows: [] };
      const who = new Map(people.map((p) => [p.id, { handle: p.handle, displayName: p.display_name }]));
      return {
        features: BEHAVIOUR_FEATURES,
        minTrainingDays: MIN_TRAINING_DAYS,
        scans: rows.map((s) => ({
          id: String(s.id),
          ranAt: s.ran_at,
          status: s.status,
          model: s.model,
          trainedRows: s.trained_rows,
          scored: s.scored,
          flagged: s.flagged,
          thresholds: s.thresholds,
          results: (s.results as { userId: string }[]).map((x) => ({ ...x, user: who.get(x.userId) ?? null })),
        })),
      };
    },
  );

  r.post(
    '/admin/behaviour/scan',
    { preHandler: admin, schema: { tags: ['admin'], summary: 'Run the abnormal-behaviour scan now' } },
    async (req) => {
      const scan = await scanBehaviour(ctx);
      await tx(ctx.db, (client) => audit(client, { action: 'admin.behaviour_scan', actorUserId: req.auth!.userId, entityType: 'behaviour_scan', entityId: String(scan.id), ip: req.ip, data: { status: scan.status } }));
      return { id: String(scan.id), status: scan.status, trainedRows: scan.trained ?? 0, scored: scan.scored ?? 0, flagged: scan.flagged ?? 0 };
    },
  );

  r.get(
    '/admin/users',
    {
      preHandler: admin,
      schema: {
        tags: ['admin'],
        summary: 'Search accounts',
        querystring: z.object({ q: z.string().max(100).optional(), limit: z.coerce.number().int().min(1).max(100).default(25) }),
      },
    },
    async (req) => {
      const q = req.query.q ? `%${req.query.q}%` : null;
      const { rows } = await ctx.db.query(
        `SELECT id, handle, email, display_name, roles, locked_until, two_fa_enabled, created_at, deleted_at FROM core.users
          WHERE ($1::text IS NULL OR handle ILIKE $1 OR email ILIKE $1 OR display_name ILIKE $1)
          ORDER BY created_at DESC LIMIT $2`,
        [q, req.query.limit],
      );
      return rows.map((u) => ({ ...u, roles: parseRoles(u.roles) }));
    },
  );

  r.put(
    '/admin/users/:id/roles',
    {
      preHandler: admin,
      schema: {
        tags: ['admin'],
        summary: 'Set a user’s roles',
        params: z.object({ id: z.uuid() }),
        body: z.object({ roles: z.array(z.enum(ALL_ROLES)).min(1) }),
      },
    },
    async (req) => {
      const roles = [...new Set(req.body.roles)];
      await tx(ctx.db, async (client) => {
        const user = await findUserById(client, req.params.id, true);
        if (!user) throw notFound('User');
        await client.query('UPDATE core.users SET roles = $2::core.user_role[] WHERE id = $1', [user.id, roles]);
        await audit(client, { action: 'admin.roles_changed', actorUserId: req.auth!.userId, entityType: 'user', entityId: user.id, ip: req.ip, data: { from: user.roles, to: roles } });
      });
      return { id: req.params.id, roles };
    },
  );

  r.post(
    '/admin/users/:id/unlock',
    { preHandler: admin, schema: { tags: ['admin'], summary: 'Clear a sign-in lockout', params: z.object({ id: z.uuid() }) } },
    async (req) => {
      await tx(ctx.db, async (client) => {
        const { rowCount } = await client.query('UPDATE core.users SET locked_until = NULL, lock_reason = NULL, failed_login_count = 0 WHERE id = $1', [req.params.id]);
        if (!rowCount) throw notFound('User');
        await audit(client, { action: 'admin.user_unlocked', actorUserId: req.auth!.userId, entityType: 'user', entityId: req.params.id, ip: req.ip });
      });
      return { ok: true };
    },
  );

  r.get(
    '/admin/audit',
    {
      preHandler: auditReader,
      schema: {
        tags: ['admin'],
        summary: 'Audit log entries, newest first (before = an entry id, to page back)',
        querystring: z.object({
          userId: z.uuid().optional(),
          action: z.string().max(80).optional(),
          entityId: z.string().max(200).optional(),
          before: z.coerce.number().int().positive().optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
        }),
      },
    },
    async (req) => {
      const q = req.query;
      const { rows } = await ctx.db.query(
        `SELECT a.id, a.occurred_at, a.actor_user_id, u.handle AS actor_handle, a.actor_service, a.action, a.entity_type, a.entity_id, a.ip, a.data, a.hash
           FROM core.audit_log a LEFT JOIN core.users u ON u.id = a.actor_user_id
          WHERE ($1::uuid IS NULL OR a.actor_user_id = $1) AND ($2::text IS NULL OR a.action LIKE $2 || '%')
            AND ($3::text IS NULL OR a.entity_id = $3) AND ($4::bigint IS NULL OR a.id < $4)
          ORDER BY a.id DESC LIMIT $5`,
        [q.userId ?? null, q.action ?? null, q.entityId ?? null, q.before ?? null, q.limit],
      );
      return rows;
    },
  );

  r.get('/admin/audit/verify', { preHandler: auditReader, schema: { tags: ['admin'], summary: 'Re-check the audit log hash chain' } }, async () =>
    verifyAuditChain(ctx.db),
  );

  // ---------------------------------------------------------------- development helpers

  if (!ctx.config.isProd) {
    r.get('/dev/mail', { schema: { tags: ['dev'], summary: 'Development only: emails the server would have sent (OTP codes)' } }, async () =>
      ctx.mailer.outbox(),
    );
  }
}
