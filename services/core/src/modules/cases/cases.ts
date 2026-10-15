import type pg from 'pg';
import type { Role } from '../../context.js';
import { audit } from '../../lib/audit.js';
import { forbidden } from '../../lib/errors.js';
import { notify } from '../../lib/notify.js';

export const CASE_KINDS = ['report', 'flag', 'support', 'dispute', 'appeal'] as const;
export type CaseKind = (typeof CASE_KINDS)[number];
export const CASE_STATUSES = ['open', 'in_progress', 'waiting', 'resolved', 'dismissed'] as const;
export const OPEN_STATUSES = ['open', 'in_progress', 'waiting'] as const;
export const CASE_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export const CASE_PLATFORMS = ['core', 'alter', 'altera', 'altar'] as const;
export const SUBJECT_TYPES = ['ai', 'user', 'post', 'comment', 'review', 'listing', 'message', 'transaction'] as const;

export const STAFF_ROLES = ['admin', 'moderator', 'support', 'auditor'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/** Which staff handle which cases. Admins and auditors see everything; auditors never change anything. */
const HANDLED_BY: Record<CaseKind, StaffRole[]> = {
  report: ['moderator'],
  flag: ['moderator'],
  appeal: ['moderator'],
  support: ['support'],
  dispute: ['support'],
};

export const isStaff = (roles: Role[]) => roles.some((r) => (STAFF_ROLES as readonly string[]).includes(r));

export function canSee(roles: Role[], kind: CaseKind) {
  return roles.includes('admin') || roles.includes('auditor') || HANDLED_BY[kind].some((r) => roles.includes(r));
}

export function canHandle(roles: Role[], kind: CaseKind) {
  return roles.includes('admin') || HANDLED_BY[kind].some((r) => roles.includes(r));
}

/** The kinds a member of staff may see, for filtering the queue in SQL. */
export function visibleKinds(roles: Role[]): CaseKind[] {
  return CASE_KINDS.filter((k) => canSee(roles, k));
}

export interface CaseRow {
  id: string;
  number: string;
  kind: CaseKind;
  status: string;
  priority: string;
  platform: string;
  category: string;
  subject_type: string | null;
  subject_id: string | null;
  subject_ai_id: string | null;
  subject_user_id: string | null;
  opened_by: string | null;
  title: string;
  reports: number;
  assignee_id: string | null;
  resolution: string | null;
  created_at: Date;
  updated_at: Date;
  closed_at: Date | null;
}

export interface NewCase {
  kind: CaseKind;
  platform: (typeof CASE_PLATFORMS)[number];
  category: string;
  title: string;
  body?: string | null;
  priority?: (typeof CASE_PRIORITIES)[number];
  subject?: { type: (typeof SUBJECT_TYPES)[number]; id: string; aiId?: string | null; userId?: string | null } | null;
  /** A snapshot of what was reported (the post's text, the review...), kept even if it is later removed. */
  evidence?: Record<string, unknown>;
  /** The person filing it; absent when a service files it on its own (an automatic flag). */
  openedBy?: string | null;
  service?: string | null;
  ip?: string | null;
}

/**
 * Files a case, inside the caller's transaction. Reports and flags about something that already has
 * an open case are merged into it (one queue item per post, however many people report it); the same
 * person reporting the same thing twice counts once.
 */
export async function fileCase(client: pg.PoolClient, n: NewCase): Promise<{ case: CaseRow; merged: boolean; duplicate: boolean }> {
  const mergeable = (n.kind === 'report' || n.kind === 'flag') && n.subject;
  if (mergeable) {
    // A person or an AI is the same everywhere in ALT, so reports about them merge whichever app they
    // came from; a post, comment or review id belongs to one platform.
    const everywhere = n.subject!.type === 'ai' || n.subject!.type === 'user';
    // Serialise filings about the same subject, so two reports at once can't open two cases.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`case:${n.kind}:${everywhere ? '*' : n.platform}:${n.subject!.type}:${n.subject!.id}`]);
    const { rows } = await client.query<CaseRow>(
      `SELECT * FROM core.cases WHERE kind = $1 AND ($6 OR platform = $2) AND subject_type = $3 AND subject_id = $4
         AND status = ANY($5::text[]) ORDER BY created_at LIMIT 1 FOR UPDATE`,
      [n.kind, n.platform, n.subject!.type, n.subject!.id, OPEN_STATUSES, everywhere],
    );
    const open = rows[0];
    if (open) {
      if (n.openedBy) {
        const { rowCount } = await client.query(
          `SELECT 1 FROM core.case_events WHERE case_id = $1 AND actor_user_id = $2 AND kind IN ('opened', 'reported')`,
          [open.id, n.openedBy],
        );
        if (rowCount) return { case: open, merged: true, duplicate: true };
      }
      const reports = open.reports + 1;
      // Three or more reports make it high priority; it never lowers a priority staff set.
      const priority = reports >= 3 && (open.priority === 'low' || open.priority === 'normal') ? 'high' : open.priority;
      const { rows: updated } = await client.query<CaseRow>(
        'UPDATE core.cases SET reports = $2, priority = $3, updated_at = now() WHERE id = $1 RETURNING *',
        [open.id, reports, priority],
      );
      await addEvent(client, open.id, {
        kind: 'reported',
        visibility: 'author',
        actorUserId: n.openedBy ?? null,
        actorService: n.service ?? null,
        body: n.body ?? null,
        data: { category: n.category, ...(n.evidence ? { evidence: n.evidence } : {}) },
      });
      return { case: updated[0]!, merged: true, duplicate: false };
    }
  }
  const { rows } = await client.query<CaseRow>(
    `INSERT INTO core.cases (kind, platform, category, title, priority, subject_type, subject_id, subject_ai_id, subject_user_id, opened_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [
      n.kind,
      n.platform,
      n.category,
      n.title.slice(0, 140),
      n.priority ?? 'normal',
      n.subject?.type ?? null,
      n.subject?.id ?? null,
      n.subject?.aiId ?? null,
      n.subject?.userId ?? null,
      n.openedBy ?? null,
    ],
  );
  const c = rows[0]!;
  await addEvent(client, c.id, {
    kind: 'opened',
    visibility: 'author',
    actorUserId: n.openedBy ?? null,
    actorService: n.service ?? null,
    body: n.body ?? null,
    data: n.evidence ? { evidence: n.evidence } : {},
  });
  await audit(client, {
    action: 'case.opened',
    actorUserId: n.openedBy ?? undefined,
    actorService: n.service ?? undefined,
    entityType: 'case',
    entityId: c.id,
    ip: n.ip ?? undefined,
    data: { number: Number(c.number), kind: c.kind, platform: c.platform, category: c.category, subject: n.subject ?? null },
  });
  if (n.openedBy && (n.kind === 'support' || n.kind === 'dispute' || n.kind === 'appeal')) {
    await notify(client, {
      userId: n.openedBy,
      category: 'system',
      type: 'case.received',
      title: `We got your request #${c.number}`,
      body: 'ALT staff will answer here and in your inbox.',
      data: { caseId: c.id, number: Number(c.number) },
    });
  }
  return { case: c, merged: false, duplicate: false };
}

export interface CaseEvent {
  kind: 'opened' | 'reported' | 'message' | 'reply' | 'note' | 'status' | 'assigned' | 'priority';
  visibility: 'staff' | 'author' | 'participants';
  actorUserId?: string | null;
  actorService?: string | null;
  body?: string | null;
  data?: Record<string, unknown>;
}

export async function addEvent(client: pg.PoolClient, caseId: string, e: CaseEvent) {
  await client.query(
    `INSERT INTO core.case_events (case_id, actor_user_id, actor_service, kind, visibility, body, data) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [caseId, e.actorUserId ?? null, e.actorService ?? null, e.kind, e.visibility, e.body ?? null, e.data ?? {}],
  );
}

/** Everyone a staff reply or outcome reaches: whoever opened the case and everyone who reported it. */
export async function participants(client: pg.PoolClient, caseId: string) {
  const { rows } = await client.query<{ user_id: string }>(
    `SELECT DISTINCT actor_user_id AS user_id FROM core.case_events
      WHERE case_id = $1 AND actor_user_id IS NOT NULL AND kind IN ('opened', 'reported', 'message')
     UNION SELECT opened_by FROM core.cases WHERE id = $1 AND opened_by IS NOT NULL`,
    [caseId],
  );
  return rows.map((r) => r.user_id);
}

/** Whether someone is involved in a case: they opened it, reported it, or it is about them. */
export async function isInvolved(q: pg.Pool | pg.PoolClient, c: CaseRow, userId: string) {
  if (c.opened_by === userId || c.subject_user_id === userId) return true;
  const { rowCount } = await q.query(`SELECT 1 FROM core.case_events WHERE case_id = $1 AND actor_user_id = $2 AND kind IN ('opened', 'reported')`, [c.id, userId]);
  return Boolean(rowCount);
}

/** Staff never handle a case they are involved in. */
export async function assertNoConflict(q: pg.Pool | pg.PoolClient, c: CaseRow, staffId: string) {
  if (await isInvolved(q, c, staffId)) {
    throw forbidden('CONFLICT_OF_INTEREST', 'This case involves you, so another member of staff must handle it.');
  }
}
