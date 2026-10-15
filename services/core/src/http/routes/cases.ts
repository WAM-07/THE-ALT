import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type pg from 'pg';
import { z } from 'zod';
import type { Ctx, Role } from '../../context.js';
import { tx } from '../../db.js';
import { audit } from '../../lib/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { notify } from '../../lib/notify.js';
import { parseRoles } from '../../modules/accounts/users.js';
import {
  addEvent,
  assertNoConflict,
  isInvolved,
  CASE_KINDS,
  CASE_PRIORITIES,
  canHandle,
  canSee,
  type CaseKind,
  type CaseRow,
  fileCase,
  OPEN_STATUSES,
  participants,
  SUBJECT_TYPES,
  visibleKinds,
} from '../../modules/cases/cases.js';
import { requireService, requireStaff, requireUser } from '../auth-guard.js';

const CaseId = z.object({ id: z.uuid() });
const Category = z.string().regex(/^[a-z][a-z_]{1,39}$/, 'lower-case words joined by _');
const Body = z.string().trim().min(1).max(5000);
const Subject = z.object({ type: z.enum(SUBJECT_TYPES), id: z.string().min(1).max(200) });
const isOpen = (status: string) => (OPEN_STATUSES as readonly string[]).includes(status);
const PRIORITY_ORDER = `CASE c.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END`;

const subjectOut = (c: CaseRow) =>
  c.subject_type ? { type: c.subject_type, id: c.subject_id, aiId: c.subject_ai_id, userId: c.subject_user_id } : null;

/** A case as the person who opened or reported it sees it: no staff names, no other reporters. */
const personOut = (c: CaseRow) => ({
  id: c.id,
  number: Number(c.number),
  kind: c.kind,
  status: c.status,
  platform: c.platform,
  category: c.category,
  title: c.title,
  subject: c.subject_type ? { type: c.subject_type, id: c.subject_id } : null,
  resolution: c.resolution,
  createdAt: c.created_at.toISOString(),
  updatedAt: c.updated_at.toISOString(),
  closedAt: c.closed_at?.toISOString() ?? null,
});

type StaffCaseRow = CaseRow & { assignee_handle?: string | null; assignee_name?: string | null; ai_name?: string | null; ai_handle?: string | null; subject_handle?: string | null; opener_handle?: string | null };

const staffOut = (c: StaffCaseRow) => ({
  ...personOut(c),
  priority: c.priority,
  reports: c.reports,
  subject: subjectOut(c),
  subjectLabel: c.ai_name ? `${c.ai_name} (@${c.ai_handle})` : c.subject_handle ? `@${c.subject_handle}` : null,
  openedBy: c.opened_by ? { id: c.opened_by, handle: c.opener_handle ?? null } : null,
  assignee: c.assignee_id ? { id: c.assignee_id, handle: c.assignee_handle ?? null, displayName: c.assignee_name ?? null } : null,
});

const STAFF_SELECT = `
  SELECT c.*, a.handle AS assignee_handle, a.display_name AS assignee_name, ai.name AS ai_name, ai.handle AS ai_handle,
         su.handle AS subject_handle, op.handle AS opener_handle
    FROM core.cases c
    LEFT JOIN core.users a ON a.id = c.assignee_id
    LEFT JOIN core.personal_ais ai ON ai.id = c.subject_ai_id
    LEFT JOIN core.users su ON su.id = c.subject_user_id
    LEFT JOIN core.users op ON op.id = c.opened_by`;

/** The ALT Portal's case queue (M3): reports, flags, support, disputes and appeals from every platform. */
export async function caseRoutes(app: FastifyInstance, ctx: Ctx) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const authed = requireUser(ctx);
  const staff = requireStaff(ctx);

  /** Fills in the AI or person a subject points at, when it is one of ALT's own ids. */
  async function resolveSubject(q: pg.PoolClient, s: z.infer<typeof Subject> & { aiId?: string | null; userId?: string | null }) {
    const uuid = z.uuid().safeParse(s.id).success;
    let aiId = s.aiId ?? null;
    let userId = s.userId ?? null;
    if (s.type === 'ai' && uuid && !aiId) {
      const { rows } = await q.query<{ id: string; owner_id: string }>('SELECT id, owner_id FROM core.personal_ais WHERE id = $1', [s.id]);
      if (!rows[0]) throw notFound('AI');
      aiId = rows[0].id;
      userId ??= rows[0].owner_id;
    }
    if (s.type === 'user' && uuid && !userId) {
      const { rowCount } = await q.query('SELECT 1 FROM core.users WHERE id = $1', [s.id]);
      if (!rowCount) throw notFound('User');
      userId = s.id;
    }
    return { ...s, aiId, userId };
  }

  // ---------------------------------------------------------------- from people

  r.post(
    '/me/cases',
    {
      preHandler: authed,
      config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
      schema: {
        tags: ['cases'],
        summary: 'Ask ALT for help, report something, open a dispute or appeal a decision',
        body: z.object({
          kind: z.enum(['support', 'report', 'dispute', 'appeal']),
          category: Category,
          title: z.string().trim().min(3).max(140),
          body: Body,
          subject: Subject.optional(),
        }),
      },
    },
    async (req, reply) => {
      const a = req.auth!;
      const platform = a.platform === 'alter' || a.platform === 'altera' || a.platform === 'altar' ? a.platform : 'core';
      const result = await tx(ctx.db, async (client) => {
        const subject = req.body.subject ? await resolveSubject(client, req.body.subject) : null;
        return fileCase(client, { ...req.body, platform, subject, openedBy: a.userId, ip: req.ip });
      });
      return reply.status(result.merged ? 200 : 201).send({ case: personOut(result.case), merged: result.merged });
    },
  );

  r.get('/me/cases', { preHandler: authed, schema: { tags: ['cases'], summary: 'Your requests and reports, newest activity first' } }, async (req) => {
    const { rows } = await ctx.db.query<CaseRow>(
      `SELECT c.* FROM core.cases c
        WHERE c.opened_by = $1
           OR EXISTS (SELECT 1 FROM core.case_events e WHERE e.case_id = c.id AND e.actor_user_id = $1 AND e.kind IN ('opened', 'reported', 'message'))
        ORDER BY c.updated_at DESC LIMIT 50`,
      [req.auth!.userId],
    );
    return { items: rows.map(personOut) };
  });

  async function myCase(userId: string, id: string) {
    const { rows } = await ctx.db.query<CaseRow>(
      `SELECT c.* FROM core.cases c WHERE c.id = $2 AND (c.opened_by = $1
          OR EXISTS (SELECT 1 FROM core.case_events e WHERE e.case_id = c.id AND e.actor_user_id = $1 AND e.kind IN ('opened', 'reported', 'message')))`,
      [userId, id],
    );
    if (!rows[0]) throw notFound('Case');
    return rows[0];
  }

  r.get('/me/cases/:id', { preHandler: authed, schema: { tags: ['cases'], summary: 'One of your cases, with the replies you can see', params: CaseId } }, async (req) => {
    const me = req.auth!.userId;
    const c = await myCase(me, req.params.id);
    const { rows } = await ctx.db.query(
      `SELECT id, at, kind, body, actor_user_id FROM core.case_events
        WHERE case_id = $1 AND (visibility = 'participants' OR (visibility = 'author' AND actor_user_id = $2)) ORDER BY id`,
      [c.id, me],
    );
    return {
      case: personOut(c),
      events: rows.map((e) => ({
        id: String(e.id),
        at: (e.at as Date).toISOString(),
        kind: e.kind as string,
        // People see "ALT" for staff, never a staff member's name.
        from: e.actor_user_id === me ? 'you' : 'alt',
        body: (e.body as string | null) ?? null,
      })),
    };
  });

  r.post(
    '/me/cases/:id/messages',
    { preHandler: authed, schema: { tags: ['cases'], summary: 'Add a message to one of your open cases', params: CaseId, body: z.object({ body: Body }) } },
    async (req) => {
      const me = req.auth!.userId;
      const c = await myCase(me, req.params.id);
      if (!isOpen(c.status)) throw conflict('CASE_CLOSED', 'This case is closed. Open a new request if you still need help.');
      await tx(ctx.db, async (client) => {
        await addEvent(client, c.id, { kind: 'message', visibility: 'author', actorUserId: me, body: req.body.body });
        // An answer to a question staff asked puts the case back in their queue.
        await client.query(`UPDATE core.cases SET updated_at = now(), status = CASE WHEN status = 'waiting' THEN 'open' ELSE status END WHERE id = $1`, [c.id]);
      });
      return { ok: true };
    },
  );

  // ---------------------------------------------------------------- from ALT services

  r.post(
    '/internal/cases',
    {
      preHandler: requireService(ctx),
      schema: {
        tags: ['internal'],
        summary: 'A platform files a report a person made, or an automatic flag',
        body: z.object({
          kind: z.enum(CASE_KINDS),
          platform: z.enum(['alter', 'altera', 'altar']),
          category: Category,
          title: z.string().trim().min(3).max(140),
          body: z.string().trim().max(5000).optional(),
          priority: z.enum(CASE_PRIORITIES).optional(),
          subject: Subject.extend({ aiId: z.uuid().nullish(), userId: z.uuid().nullish() }).optional(),
          evidence: z.record(z.string(), z.unknown()).optional(),
          reporterId: z.uuid().optional(),
        }),
      },
    },
    async (req, reply) => {
      const b = req.body;
      const result = await tx(ctx.db, async (client) => {
        if (b.reporterId) {
          const { rowCount } = await client.query('SELECT 1 FROM core.users WHERE id = $1 AND deleted_at IS NULL', [b.reporterId]);
          if (!rowCount) throw notFound('Reporter');
        }
        const subject = b.subject ? await resolveSubject(client, b.subject) : null;
        return fileCase(client, { ...b, subject, openedBy: b.reporterId ?? null, service: req.service, ip: req.ip });
      });
      return reply
        .status(result.merged ? 200 : 201)
        .send({ caseId: result.case.id, number: Number(result.case.number), merged: result.merged, duplicate: result.duplicate });
    },
  );

  // ---------------------------------------------------------------- the ALT Portal (staff)

  const roles = (req: { auth?: { roles: Role[] } }) => req.auth!.roles;

  r.get('/staff/summary', { preHandler: staff, schema: { tags: ['staff'], summary: 'Queue counts for the portal dashboard' } }, async (req) => {
    const kinds = visibleKinds(roles(req));
    const { rows } = await ctx.db.query<{ kind: string; status: string; n: string; unassigned: string; mine: string; urgent: string; oldest: Date | null }>(
      `SELECT kind, status, count(*) AS n, count(*) FILTER (WHERE assignee_id IS NULL) AS unassigned,
              count(*) FILTER (WHERE assignee_id = $2) AS mine,
              count(*) FILTER (WHERE priority IN ('high', 'urgent')) AS urgent, min(created_at) AS oldest
         FROM core.cases WHERE kind = ANY($1::text[]) AND status = ANY($3::text[]) GROUP BY kind, status`,
      [kinds, req.auth!.userId, OPEN_STATUSES],
    );
    const sum = (f: (r: (typeof rows)[number]) => string) => rows.reduce((t, r) => t + Number(f(r)), 0);
    const oldest = rows.map((r) => r.oldest).filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0];
    return {
      open: sum((r) => r.n),
      unassigned: sum((r) => r.unassigned),
      mine: sum((r) => r.mine),
      highPriority: sum((r) => r.urgent),
      oldestOpenAt: oldest?.toISOString() ?? null,
      byKind: Object.fromEntries(kinds.map((k) => [k, rows.filter((r) => r.kind === k).reduce((t, r) => t + Number(r.n), 0)])),
      byStatus: Object.fromEntries(OPEN_STATUSES.map((s) => [s, rows.filter((r) => r.status === s).reduce((t, r) => t + Number(r.n), 0)])),
      kinds,
    };
  });

  r.get(
    '/staff/cases',
    {
      preHandler: staff,
      schema: {
        tags: ['staff'],
        summary: 'The case queue: most urgent first, then most recently active',
        querystring: z.object({
          status: z.enum(['active', 'closed', 'all', 'open', 'in_progress', 'waiting', 'resolved', 'dismissed']).default('active'),
          kind: z.enum(CASE_KINDS).optional(),
          platform: z.enum(['core', 'alter', 'altera', 'altar']).optional(),
          assignee: z.union([z.enum(['me', 'none']), z.uuid()]).optional(),
          q: z.string().trim().max(100).optional(),
          limit: z.coerce.number().int().min(1).max(100).default(50),
          offset: z.coerce.number().int().min(0).max(10_000).default(0),
        }),
      },
    },
    async (req) => {
      const q = req.query;
      const kinds = visibleKinds(roles(req)).filter((k) => !q.kind || k === q.kind);
      const statuses =
        q.status === 'active' ? [...OPEN_STATUSES] : q.status === 'closed' ? ['resolved', 'dismissed'] : q.status === 'all' ? null : [q.status];
      const assignee = q.assignee === 'me' ? req.auth!.userId : q.assignee;
      const num = q.q && /^#?\d+$/.test(q.q) ? Number(q.q.replace('#', '')) : null;
      const { rows } = await ctx.db.query<StaffCaseRow>(
        `${STAFF_SELECT}
          WHERE c.kind = ANY($1::text[]) AND ($2::text[] IS NULL OR c.status = ANY($2::text[]))
            AND ($3::text IS NULL OR c.platform = $3)
            AND ($4::text IS NULL OR ($4 = 'none' AND c.assignee_id IS NULL) OR c.assignee_id::text = $4)
            AND ($5::text IS NULL OR c.title ILIKE '%' || $5 || '%' OR c.category ILIKE $5 OR c.number = $6)
          ORDER BY ${PRIORITY_ORDER}, c.updated_at DESC LIMIT $7 OFFSET $8`,
        [kinds, statuses, q.platform ?? null, assignee ?? null, q.q || null, num, q.limit, q.offset],
      );
      return { items: rows.map(staffOut) };
    },
  );

  async function staffCase(id: string, staffRoles: Role[], forWrite: boolean, client: pg.PoolClient | null = null) {
    const { rows } = await (client ?? ctx.db).query<StaffCaseRow>(`${STAFF_SELECT} WHERE c.id = $1${client ? ' FOR UPDATE OF c' : ''}`, [id]);
    const c = rows[0];
    if (!c || !canSee(staffRoles, c.kind)) throw notFound('Case');
    if (forWrite && !canHandle(staffRoles, c.kind)) throw forbidden('NOT_YOUR_QUEUE', 'Your role can view this case but not change it.');
    return c;
  }

  r.get('/staff/cases/:id', { preHandler: staff, schema: { tags: ['staff'], summary: 'A case with its full history and evidence', params: CaseId } }, async (req) => {
    const c = await staffCase(req.params.id, roles(req), false);
    const { rows } = await ctx.db.query(
      `SELECT e.*, u.handle, u.display_name FROM core.case_events e LEFT JOIN core.users u ON u.id = e.actor_user_id WHERE e.case_id = $1 ORDER BY e.id`,
      [c.id],
    );
    return {
      case: staffOut(c),
      canHandle: canHandle(roles(req), c.kind) && !(await isInvolved(ctx.db, c, req.auth!.userId)),
      events: rows.map((e) => ({
        id: String(e.id),
        at: (e.at as Date).toISOString(),
        kind: e.kind as string,
        visibility: e.visibility as string,
        actor: e.actor_user_id
          ? { userId: e.actor_user_id as string, handle: e.handle as string | null, displayName: e.display_name as string | null }
          : e.actor_service
            ? { service: e.actor_service as string }
            : null,
        body: (e.body as string | null) ?? null,
        data: e.data,
      })),
    };
  });

  /** One staff change to a case: locked, checked, applied, recorded in the case and the audit log. */
  async function change(req: { params: { id: string }; auth?: { userId: string; roles: Role[] }; ip: string }, action: string, fn: (client: pg.PoolClient, c: StaffCaseRow) => Promise<Record<string, unknown>>) {
    return tx(ctx.db, async (client) => {
      const c = await staffCase(req.params.id, req.auth!.roles, true, client);
      await assertNoConflict(client, c, req.auth!.userId);
      const data = await fn(client, c);
      await client.query('UPDATE core.cases SET updated_at = now() WHERE id = $1', [c.id]);
      await audit(client, { action, actorUserId: req.auth!.userId, entityType: 'case', entityId: c.id, ip: req.ip, data: { number: Number(c.number), ...data } });
      const { rows } = await client.query<StaffCaseRow>(`${STAFF_SELECT} WHERE c.id = $1`, [c.id]);
      return { case: staffOut(rows[0]!) };
    });
  }

  r.post(
    '/staff/cases/:id/assign',
    {
      preHandler: staff,
      schema: { tags: ['staff'], summary: 'Take a case, hand it to someone, or put it back (null)', params: CaseId, body: z.object({ assigneeId: z.uuid().nullable().optional() }) },
    },
    async (req) =>
      change(req, 'case.assigned', async (client, c) => {
        const to = req.body.assigneeId === undefined ? req.auth!.userId : req.body.assigneeId;
        if (to) {
          const { rows } = await client.query<{ roles: unknown }>('SELECT roles FROM core.users WHERE id = $1 AND deleted_at IS NULL', [to]);
          if (!rows[0] || !canHandle(parseRoles(rows[0].roles), c.kind)) throw badRequest('NOT_STAFF_FOR_THIS', 'That person cannot handle this kind of case.');
          if (await isInvolved(client, c, to)) throw badRequest('CONFLICT_OF_INTEREST', 'That person is involved in this case.');
        }
        await client.query(`UPDATE core.cases SET assignee_id = $2, status = CASE WHEN status = 'open' AND $2::uuid IS NOT NULL THEN 'in_progress' ELSE status END WHERE id = $1`, [c.id, to]);
        await addEvent(client, c.id, { kind: 'assigned', visibility: 'staff', actorUserId: req.auth!.userId, data: { from: c.assignee_id, to } });
        return { to };
      }),
  );

  r.post(
    '/staff/cases/:id/notes',
    { preHandler: staff, schema: { tags: ['staff'], summary: 'An internal note (staff only)', params: CaseId, body: z.object({ body: Body }) } },
    async (req) =>
      change(req, 'case.noted', async (client, c) => {
        await addEvent(client, c.id, { kind: 'note', visibility: 'staff', actorUserId: req.auth!.userId, body: req.body.body });
        return {};
      }),
  );

  r.post(
    '/staff/cases/:id/reply',
    {
      preHandler: staff,
      schema: {
        tags: ['staff'],
        summary: 'Reply to the people on a case (shown as "ALT"; they also get it in their inbox)',
        params: CaseId,
        body: z.object({ body: Body, waitForAnswer: z.boolean().default(false) }),
      },
    },
    async (req) =>
      change(req, 'case.replied', async (client, c) => {
        if (!isOpen(c.status)) throw conflict('CASE_CLOSED', 'Reopen the case to reply.');
        await addEvent(client, c.id, { kind: 'reply', visibility: 'participants', actorUserId: req.auth!.userId, body: req.body.body });
        if (req.body.waitForAnswer) await client.query(`UPDATE core.cases SET status = 'waiting' WHERE id = $1`, [c.id]);
        const people = await participants(client, c.id);
        for (const userId of people) {
          await notify(client, {
            userId,
            category: c.kind === 'support' || c.kind === 'dispute' ? 'system' : 'moderation',
            type: 'case.reply',
            title: `ALT replied about #${c.number}`,
            body: req.body.body.slice(0, 300),
            data: { caseId: c.id, number: Number(c.number) },
          });
        }
        return { notified: people.length };
      }),
  );

  r.patch(
    '/staff/cases/:id',
    {
      preHandler: staff,
      schema: {
        tags: ['staff'],
        summary: 'Change status (open, in progress, waiting; also reopens a closed case) or priority',
        params: CaseId,
        body: z.object({ status: z.enum(OPEN_STATUSES).optional(), priority: z.enum(CASE_PRIORITIES).optional() }),
      },
    },
    async (req) =>
      change(req, 'case.updated', async (client, c) => {
        const { status, priority } = req.body;
        if (!status && !priority) throw badRequest('NOTHING_TO_CHANGE', 'Give a status or a priority.');
        if (status && status !== c.status) {
          await client.query('UPDATE core.cases SET status = $2, closed_at = NULL, resolution = CASE WHEN $3 THEN NULL ELSE resolution END WHERE id = $1', [
            c.id,
            status,
            !isOpen(c.status),
          ]);
          await addEvent(client, c.id, { kind: 'status', visibility: 'participants', actorUserId: req.auth!.userId, data: { from: c.status, to: status } });
        }
        if (priority && priority !== c.priority) {
          await client.query('UPDATE core.cases SET priority = $2 WHERE id = $1', [c.id, priority]);
          await addEvent(client, c.id, { kind: 'priority', visibility: 'staff', actorUserId: req.auth!.userId, data: { from: c.priority, to: priority } });
        }
        return { status: status ?? null, priority: priority ?? null };
      }),
  );

  r.post(
    '/staff/cases/:id/resolve',
    {
      preHandler: staff,
      schema: {
        tags: ['staff'],
        summary: 'Close a case as resolved or dismissed, telling the people on it why',
        params: CaseId,
        body: z.object({ outcome: z.enum(['resolved', 'dismissed']), resolution: z.string().trim().min(3).max(2000), notifyPeople: z.boolean().default(true) }),
      },
    },
    async (req) =>
      change(req, `case.${req.body.outcome}`, async (client, c) => {
        if (!isOpen(c.status)) throw conflict('CASE_CLOSED', 'This case is already closed.');
        const { outcome, resolution } = req.body;
        await client.query('UPDATE core.cases SET status = $2, resolution = $3, closed_at = now() WHERE id = $1', [c.id, outcome, resolution]);
        await addEvent(client, c.id, { kind: 'status', visibility: 'participants', actorUserId: req.auth!.userId, body: resolution, data: { from: c.status, to: outcome } });
        const people = req.body.notifyPeople ? await participants(client, c.id) : [];
        for (const userId of people) {
          await notify(client, {
            userId,
            category: c.kind === 'support' || c.kind === 'dispute' ? 'system' : 'moderation',
            type: `case.${outcome}`,
            title: c.kind === 'report' ? `Your report #${c.number} was reviewed` : `#${c.number} is closed`,
            body: resolution.slice(0, 300),
            data: { caseId: c.id, number: Number(c.number), outcome },
          });
        }
        return { outcome, notified: people.length };
      }),
  );

  // Kinds are fixed, so the portal can build its filters from this.
  r.get('/staff/me', { preHandler: staff, schema: { tags: ['staff'], summary: 'What this member of staff may see and do' } }, async (req) => ({
    roles: roles(req).filter((x) => ['admin', 'moderator', 'support', 'auditor'].includes(x)),
    sees: visibleKinds(roles(req)),
    handles: CASE_KINDS.filter((k: CaseKind) => canHandle(roles(req), k)),
  }));
}
