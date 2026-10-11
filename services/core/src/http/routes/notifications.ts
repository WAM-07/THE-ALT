import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Ctx } from '../../context.js';
import { tx } from '../../db.js';
import { audit } from '../../lib/audit.js';
import { notFound } from '../../lib/errors.js';
import { NOTIFICATIONS_CHANNEL, notify } from '../../lib/notify.js';
import { isSessionActive } from '../../modules/accounts/sessions.js';
import { requireRole, requireService, requireUser } from '../auth-guard.js';

const out = (n: Record<string, unknown>) => ({
  id: n.id as string,
  category: n.category as string,
  type: n.type as string,
  title: n.title as string,
  body: (n.body as string | null) ?? null,
  data: n.data,
  platform: n.platform as string,
  link: (n.link as string | null) ?? null,
  read: Boolean(n.read_at),
  createdAt: (n.created_at as Date).toISOString(),
});

const Category = z.enum(['ai', 'security', 'moderation', 'social', 'transaction', 'system']);

/** Module 2: one inbox for ALTER, ALTAR and ALTERA, delivered in real time. */
export async function notificationRoutes(app: FastifyInstance, ctx: Ctx) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const authed = requireUser(ctx);

  const unreadCount = async (userId: string) => {
    const { rows } = await ctx.db.query<{ n: string }>('SELECT count(*) AS n FROM core.notifications WHERE user_id = $1 AND read_at IS NULL', [userId]);
    return Number(rows[0]?.n ?? 0);
  };

  r.get(
    '/notifications',
    {
      preHandler: authed,
      schema: {
        tags: ['notifications'],
        summary: 'Your ALT inbox (newest first)',
        querystring: z.object({
          unread: z.enum(['true', 'false']).optional(),
          category: Category.optional(),
          before: z.iso.datetime().optional(),
          limit: z.coerce.number().int().min(1).max(100).default(30),
        }),
      },
    },
    async (req) => {
      const q = req.query;
      const { rows } = await ctx.db.query(
        `SELECT * FROM core.notifications
          WHERE user_id = $1 AND ($2::boolean IS NOT TRUE OR read_at IS NULL)
            AND ($3::text IS NULL OR category = $3) AND ($4::timestamptz IS NULL OR created_at < $4)
          ORDER BY created_at DESC LIMIT $5`,
        [req.auth!.userId, q.unread === 'true', q.category ?? null, q.before ?? null, q.limit],
      );
      return { items: rows.map(out), unreadCount: await unreadCount(req.auth!.userId) };
    },
  );

  r.get('/notifications/unread-count', { preHandler: authed, schema: { tags: ['notifications'], summary: 'How many unread notifications' } }, async (req) => ({
    unreadCount: await unreadCount(req.auth!.userId),
  }));

  r.post(
    '/notifications/:id/read',
    { preHandler: authed, schema: { tags: ['notifications'], summary: 'Mark one as read', params: z.object({ id: z.uuid() }) } },
    async (req) => {
      const { rowCount } = await ctx.db.query('UPDATE core.notifications SET read_at = COALESCE(read_at, now()) WHERE id = $1 AND user_id = $2', [
        req.params.id,
        req.auth!.userId,
      ]);
      if (!rowCount) throw notFound('Notification');
      return { unreadCount: await unreadCount(req.auth!.userId) };
    },
  );

  r.post('/notifications/read-all', { preHandler: authed, schema: { tags: ['notifications'], summary: 'Mark everything as read' } }, async (req) => {
    await ctx.db.query('UPDATE core.notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [req.auth!.userId]);
    return { unreadCount: 0 };
  });

  /**
   * Real-time delivery (Module 2 FE-4) as Server-Sent Events: `event: notification` for each new
   * one, comments as keep-alives. Closes itself once the session is signed out.
   */
  r.get('/notifications/stream', { preHandler: authed, schema: { tags: ['notifications'], summary: 'Live stream of new notifications (text/event-stream)' } }, async (req, reply) => {
    const userId = req.auth!.userId;
    const sessionId = req.auth!.sessionId;
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    let open = true;
    const write = (chunk: string) => {
      if (open) res.write(chunk);
    };
    write(`event: ready\ndata: ${JSON.stringify({ unreadCount: await unreadCount(userId) })}\n\n`);

    const onNotification = async (id: string) => {
      const { rows } = await ctx.db.query('SELECT * FROM core.notifications WHERE id = $1 AND user_id = $2', [id, userId]);
      if (rows[0]) write(`event: notification\ndata: ${JSON.stringify(out(rows[0]))}\n\n`);
    };
    ctx.hub.on(`user:${userId}`, onNotification);
    const beat = setInterval(async () => {
      if (!(await isSessionActive(ctx.db, sessionId).catch(() => true))) {
        write('event: signed_out\ndata: {}\n\n');
        res.end();
        return;
      }
      write(': keep-alive\n\n');
    }, 10_000);
    const close = () => {
      open = false;
      clearInterval(beat);
      ctx.hub.off(`user:${userId}`, onNotification);
    };
    req.raw.on('close', close);
    res.on('close', close);
  });

  // ---------------------------------------------------------------- from other ALT services

  r.post(
    '/internal/notifications',
    {
      preHandler: requireService(ctx),
      schema: {
        tags: ['internal'],
        summary: 'Put a notification in a person’s ALT inbox (e.g. ALTERA moderation alerts)',
        body: z.object({
          userId: z.uuid(),
          category: Category,
          type: z.string().min(1).max(60),
          title: z.string().min(1).max(140),
          body: z.string().max(1000).optional(),
          data: z.record(z.string(), z.unknown()).optional(),
          link: z.string().max(500).optional(),
        }),
      },
    },
    async (req, reply) => {
      const platform = (['alter', 'altera', 'altar'] as const).find((p) => p === req.service) ?? 'core';
      const id = await notify(ctx.db, { ...req.body, platform });
      return reply.status(201).send({ id });
    },
  );

  // ---------------------------------------------------------------- system-wide announcements (FE-3)

  r.post(
    '/admin/notifications/broadcast',
    {
      preHandler: requireRole(ctx, 'admin'),
      schema: {
        tags: ['admin'],
        summary: 'Announce something to every ALT user',
        body: z.object({ title: z.string().min(1).max(140), body: z.string().max(1000).optional() }),
      },
    },
    async (req) => {
      const sent = await tx(ctx.db, async (client) => {
        const { rows } = await client.query<{ id: string; user_id: string }>(
          `INSERT INTO core.notifications (user_id, category, type, title, body, platform)
           SELECT id, 'system', 'system.announcement', $1, $2, 'admin' FROM core.users WHERE deleted_at IS NULL
           RETURNING id, user_id`,
          [req.body.title, req.body.body ?? null],
        );
        for (const row of rows) {
          await client.query('SELECT pg_notify($1, $2)', [NOTIFICATIONS_CHANNEL, JSON.stringify({ id: row.id, userId: row.user_id })]);
        }
        await audit(client, { action: 'admin.broadcast', actorUserId: req.auth!.userId, entityType: 'system', data: { title: req.body.title, recipients: rows.length } });
        return rows.length;
      });
      return { sent };
    },
  );
}
