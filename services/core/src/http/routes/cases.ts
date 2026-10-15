import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type pg from 'pg';
import { z } from 'zod';
import type { Ctx, Role } from '../../context.js';
import { tx } from '../../db.js';
import { audit } from '../../lib/audit.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { notify } from '../../lib/notify.js';
import { callService } from '../../lib/services.js';
import { revokeAllSessions } from '../../modules/accounts/sessions.js';
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

/** The ALT Command Centre's case queue (M3): reports, flags, support, disputes and appeals from every platform. */
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

  // ---------------------------------------------------------------- the ALT Command Centre (staff)

  const roles = (req: { auth?: { roles: Role[] } }) => req.auth!.roles;

  r.get('/staff/summary', { preHandler: staff, schema: { tags: ['staff'], summary: 'Queue counts for the Command Centre dashboard' } }, async (req) => {
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
      targets: await targetsOf(c),
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

  // ---------------------------------------------------------------- actions from a case (P4)

  /** What a case is about, as staff can act on it: the AI, the person, the post, comment or review. */
  async function targetsOf(c: CaseRow) {
    const ai = c.subject_ai_id
      ? (
          await ctx.db.query<{ id: string; name: string; handle: string; status: string; token_id: string | null; suspended: boolean | null }>(
            `SELECT a.id, a.name, a.handle, a.status, t.token_id, t.suspended FROM core.personal_ais a
               LEFT JOIN core.ai_identity_tokens t ON t.ai_id = a.id WHERE a.id = $1`,
            [c.subject_ai_id],
          )
        ).rows[0]
      : undefined;
    const person = c.subject_user_id
      ? (
          await ctx.db.query<{ id: string; handle: string; display_name: string; locked_until: Date | null; roles: unknown; warnings: string }>(
            `SELECT u.id, u.handle, u.display_name, u.locked_until, u.roles,
                    (SELECT count(*) FROM core.case_events e WHERE e.kind = 'action' AND e.data->>'action' = 'warn_user' AND e.data->>'userId' = u.id::text) AS warnings
               FROM core.users u WHERE u.id = $1`,
            [c.subject_user_id],
          )
        ).rows[0]
      : undefined;
    const removable = (c.platform === 'altera' && (c.subject_type === 'post' || c.subject_type === 'comment')) || (c.platform === 'altar' && c.subject_type === 'review');
    return {
      ai: ai ? { id: ai.id, name: ai.name, handle: ai.handle, status: ai.status, tokenId: ai.token_id, suspended: Boolean(ai.suspended) } : null,
      person: person
        ? {
            id: person.id,
            handle: person.handle,
            displayName: person.display_name,
            lockedUntil: person.locked_until && person.locked_until > new Date() ? person.locked_until.toISOString() : null,
            staff: parseRoles(person.roles).some((r) => ['admin', 'moderator', 'support', 'auditor'].includes(r)),
            warnings: Number(person.warnings),
          }
        : null,
      content: removable ? { type: c.subject_type, id: c.subject_id, platform: c.platform } : null,
      canSuspendOnChain: Boolean(ctx.chain?.canGovern),
    };
  }

  const Reason = z.string().trim().min(3).max(1000);
  const ActionBody = z.discriminatedUnion('action', [
    z.object({ action: z.literal('suspend_ai'), reason: Reason }),
    z.object({ action: z.literal('unsuspend_ai'), reason: Reason }),
    z.object({ action: z.literal('remove_content'), reason: Reason }),
    z.object({ action: z.literal('warn_user'), reason: Reason }),
    z.object({ action: z.literal('lock_account'), reason: Reason, days: z.number().int().min(1).max(3650).nullable() }),
    z.object({ action: z.literal('unlock_account'), reason: Reason }),
  ]);
  // Warnings may come from support too; everything else is moderation.
  const MAY_ACT: Record<z.infer<typeof ActionBody>['action'], Role[]> = {
    suspend_ai: ['admin', 'moderator'],
    unsuspend_ai: ['admin', 'moderator'],
    remove_content: ['admin', 'moderator'],
    warn_user: ['admin', 'moderator', 'support'],
    lock_account: ['admin', 'moderator'],
    unlock_account: ['admin', 'moderator'],
  };
  const appealHint = 'If you think this is a mistake, appeal it under Help & support in any ALT app.';
  const INDEFINITE = new Date('2100-01-01T00:00:00Z');

  r.post(
    '/staff/cases/:id/actions',
    {
      preHandler: staff,
      schema: {
        tags: ['staff'],
        summary: 'Act on what a case is about: suspend or restore an AI on-chain, remove the post, comment or review, warn the person, lock or unlock their account',
        params: CaseId,
        body: ActionBody,
      },
    },
    async (req) => {
      const b = req.body;
      if (!MAY_ACT[b.action].some((role) => req.auth!.roles.includes(role))) throw forbidden('NOT_YOUR_ACTION', 'Your role cannot take this action.');
      return change(req, `case.action.${b.action}`, async (client, c) => {
        const me = req.auth!.userId;
        const record = async (data: Record<string, unknown>) => {
          await addEvent(client, c.id, { kind: 'action', visibility: 'staff', actorUserId: me, body: b.reason, data: { action: b.action, ...data } });
          return { action: b.action, ...data };
        };
        const tell = (userId: string, type: string, title: string, body: string) =>
          notify(client, { userId, category: 'moderation', type, title, body: `${body} ${appealHint}`.slice(0, 1000), data: { caseNumber: Number(c.number) } });

        if (b.action === 'suspend_ai' || b.action === 'unsuspend_ai') {
          const suspend = b.action === 'suspend_ai';
          if (!c.subject_ai_id) throw badRequest('NO_AI', 'This case is not about an AI.');
          const { rows } = await client.query<{ name: string; owner_id: string; token_id: string | null; suspended: boolean | null }>(
            `SELECT a.name, a.owner_id, t.token_id, t.suspended FROM core.personal_ais a LEFT JOIN core.ai_identity_tokens t ON t.ai_id = a.id WHERE a.id = $1 FOR UPDATE OF a`,
            [c.subject_ai_id],
          );
          const ai = rows[0];
          if (!ai) throw notFound('AI');
          if (!ai.token_id) throw conflict('AI_NOT_ON_CHAIN', 'This AI has no identity token, so there is nothing to suspend on-chain.');
          if (Boolean(ai.suspended) === suspend) throw conflict(suspend ? 'ALREADY_SUSPENDED' : 'NOT_SUSPENDED', suspend ? 'This AI is already suspended.' : 'This AI is not suspended.');
          if (!ctx.chain) throw new AppError(503, 'CHAIN_DISABLED', 'The blockchain is not configured on this server.');
          const tx = await ctx.chain.setSuspended(BigInt(ai.token_id), suspend, b.reason);
          await client.query('UPDATE core.ai_identity_tokens SET suspended = $2, synced_at = now() WHERE ai_id = $1', [c.subject_ai_id, suspend]);
          await client.query(`UPDATE core.personal_ais SET status = $2 WHERE id = $1`, [c.subject_ai_id, suspend ? 'suspended' : 'verified']);
          // ALTERA and ALTAR hear it at once (the AI stops acting there, or comes back).
          await client.query(`SELECT pg_notify('alt_ai_events', $1)`, [JSON.stringify({ aiId: c.subject_ai_id, event: suspend ? 'suspended' : 'updated' })]);
          await tell(
            ai.owner_id,
            suspend ? 'ai.suspended' : 'ai.unsuspended',
            suspend ? `ALT suspended ${ai.name}` : `${ai.name} is active again`,
            suspend ? `${ai.name} can't speak, post or be sold until this is lifted. Reason: ${b.reason}` : `The suspension was lifted. ${b.reason}`,
          );
          return record({ aiId: c.subject_ai_id, tokenId: ai.token_id, txHash: tx.hash, explorer: ctx.chain.explorerTx(tx.hash) });
        }

        if (b.action === 'remove_content') {
          const what = c.subject_type;
          if (c.platform === 'altera' && (what === 'post' || what === 'comment')) {
            await callService(ctx, 'altera', '/internal/moderation/remove', { type: what, id: c.subject_id, reason: b.reason, caseNumber: Number(c.number) });
          } else if (c.platform === 'altar' && what === 'review') {
            const [aiId, reviewerId] = String(c.subject_id).split(':');
            await callService(ctx, 'altar', '/internal/reviews/remove', { aiId, reviewerId, reason: b.reason, caseNumber: Number(c.number) });
          } else {
            throw badRequest('NOTHING_TO_REMOVE', 'This case is not about a post, comment or review.');
          }
          if (c.subject_user_id) {
            const platform = c.platform === 'altera' ? 'ALTERA' : 'ALTAR';
            await tell(c.subject_user_id, 'content.removed', `ALT removed your ${what} on ${platform}`, `It broke ALT's content rules. Reason: ${b.reason}`);
          }
          return record({ type: what, id: c.subject_id, platform: c.platform, userId: c.subject_user_id });
        }

        // The rest act on the person the case is about (an AI's owner, for a case about an AI).
        const userId = c.subject_user_id;
        if (!userId) throw badRequest('NO_PERSON', 'This case is not about a person.');
        const { rows: people } = await client.query<{ email: string; display_name: string; roles: unknown; locked_until: Date | null }>(
          'SELECT email, display_name, roles, locked_until FROM core.users WHERE id = $1 FOR UPDATE',
          [userId],
        );
        const person = people[0];
        if (!person) throw notFound('Person');

        if (b.action === 'warn_user') {
          await tell(userId, 'account.warning', 'A warning from ALT', b.reason);
          return record({ userId });
        }

        if (b.action === 'lock_account') {
          const theirRoles = parseRoles(person.roles);
          if (!req.auth!.roles.includes('admin') && theirRoles.some((r) => ['admin', 'moderator', 'support', 'auditor'].includes(r))) {
            throw forbidden('STAFF_ACCOUNT', 'Only an admin can lock a member of staff.');
          }
          const until = b.days ? new Date(Date.now() + b.days * 86_400_000) : INDEFINITE;
          await client.query('UPDATE core.users SET locked_until = $2 WHERE id = $1', [userId, until]);
          // Signed out everywhere at once: every ALT service hears it (alt_sessions_revoked).
          const sessions = await revokeAllSessions(client, userId, 'locked_by_staff');
          const when = b.days ? `until ${until.toUTCString()}` : 'until further notice';
          await tell(userId, 'account.locked', 'ALT suspended your account', `Your account is suspended ${when}. Reason: ${b.reason}`);
          // They can't sign in to read their inbox, so the reason also goes by email.
          await ctx.mailer.send({
            to: person.email,
            subject: 'Your ALT account is suspended',
            text: `Hello ${person.display_name},\n\nALT suspended your account ${when}.\n\nReason: ${b.reason}\n\nYou can't sign in to ALTER, ALTERA or ALTAR meanwhile. If you think this is a mistake, reply to this email.\n\nTHE ALT`,
          });
          return record({ userId, until: b.days ? until.toISOString() : null, sessionsEnded: sessions });
        }

        // unlock_account
        await client.query('UPDATE core.users SET locked_until = NULL, failed_login_count = 0 WHERE id = $1', [userId]);
        await tell(userId, 'account.unlocked', 'Your ALT account is active again', b.reason);
        await ctx.mailer.send({ to: person.email, subject: 'Your ALT account is active again', text: `Hello ${person.display_name},\n\nYou can sign in to ALT again. ${b.reason}\n\nTHE ALT` });
        return record({ userId });
      });
    },
  );

  // Kinds are fixed, so the Command Centre can build its filters from this.
  r.get('/staff/me', { preHandler: staff, schema: { tags: ['staff'], summary: 'What this member of staff may see and do' } }, async (req) => ({
    roles: roles(req).filter((x) => ['admin', 'moderator', 'support', 'auditor'].includes(x)),
    sees: visibleKinds(roles(req)),
    handles: CASE_KINDS.filter((k: CaseKind) => canHandle(roles(req), k)),
  }));
}
