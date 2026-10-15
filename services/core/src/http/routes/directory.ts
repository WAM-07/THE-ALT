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
import { requireRole, requireService } from '../auth-guard.js';
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
        const { rowCount } = await client.query('UPDATE core.users SET locked_until = NULL, failed_login_count = 0 WHERE id = $1', [req.params.id]);
        if (!rowCount) throw notFound('User');
        await audit(client, { action: 'admin.user_unlocked', actorUserId: req.auth!.userId, entityType: 'user', entityId: req.params.id, ip: req.ip });
      });
      return { ok: true };
    },
  );

  r.get(
    '/admin/audit',
    {
      preHandler: admin,
      schema: {
        tags: ['admin'],
        summary: 'Recent audit log entries',
        querystring: z.object({
          userId: z.uuid().optional(),
          action: z.string().max(80).optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
        }),
      },
    },
    async (req) => {
      const { rows } = await ctx.db.query(
        `SELECT id, occurred_at, actor_user_id, actor_service, action, entity_type, entity_id, ip, data, hash FROM core.audit_log
          WHERE ($1::uuid IS NULL OR actor_user_id = $1) AND ($2::text IS NULL OR action LIKE $2 || '%')
          ORDER BY id DESC LIMIT $3`,
        [req.query.userId ?? null, req.query.action ?? null, req.query.limit],
      );
      return rows;
    },
  );

  r.get('/admin/audit/verify', { preHandler: admin, schema: { tags: ['admin'], summary: 'Re-check the audit log hash chain' } }, async () =>
    verifyAuditChain(ctx.db),
  );

  // ---------------------------------------------------------------- development helpers

  if (!ctx.config.isProd) {
    r.get('/dev/mail', { schema: { tags: ['dev'], summary: 'Development only: emails the server would have sent (OTP codes)' } }, async () =>
      ctx.mailer.outbox(),
    );
  }
}
