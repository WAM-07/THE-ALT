import type pg from 'pg';
import { sha256 } from './crypto.js';

export interface AuditEntry {
  action: string;
  actorUserId?: string | null;
  actorService?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  ip?: string | null;
  data?: Record<string, unknown>;
}

/** Canonical JSON (sorted keys) so the same entry always hashes the same way. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .filter((k) => obj[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
    .join(',')}}`;
}

export function entryHash(prevHash: string | null, occurredAt: string, e: AuditEntry) {
  return sha256(
    canonical({
      prev: prevHash,
      at: occurredAt,
      action: e.action,
      actorUserId: e.actorUserId ?? null,
      actorService: e.actorService ?? null,
      entityType: e.entityType ?? null,
      entityId: e.entityId ?? null,
      data: e.data ?? {},
    }),
  );
}

/**
 * Appends to the hash chain. Must run inside a transaction: the advisory lock serialises writers
 * so two entries never claim the same predecessor.
 */
export async function audit(client: pg.PoolClient, e: AuditEntry) {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('core.audit_log'))`);
  const { rows } = await client.query<{ hash: string }>('SELECT hash FROM core.audit_log ORDER BY id DESC LIMIT 1');
  const prevHash = rows[0]?.hash ?? null;
  const occurredAt = new Date().toISOString();
  const hash = entryHash(prevHash, occurredAt, e);
  await client.query(
    `INSERT INTO core.audit_log (occurred_at, actor_user_id, actor_service, action, entity_type, entity_id, ip, data, prev_hash, hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [occurredAt, e.actorUserId ?? null, e.actorService ?? null, e.action, e.entityType ?? null, e.entityId ?? null, e.ip ?? null, e.data ?? {}, prevHash, hash],
  );
}

/** Re-computes the whole chain. Returns the id of the first broken row, or null if intact. */
export async function verifyAuditChain(db: pg.Pool): Promise<{ ok: boolean; brokenAt: string | null; checked: number }> {
  const { rows } = await db.query(
    `SELECT id, occurred_at, actor_user_id, actor_service, action, entity_type, entity_id, data, prev_hash, hash
       FROM core.audit_log ORDER BY id`,
  );
  let prev: string | null = null;
  for (const r of rows) {
    const expected = entryHash(prev, new Date(r.occurred_at).toISOString(), {
      action: r.action,
      actorUserId: r.actor_user_id,
      actorService: r.actor_service,
      entityType: r.entity_type,
      entityId: r.entity_id,
      data: r.data,
    });
    if (r.prev_hash !== prev || r.hash !== expected) return { ok: false, brokenAt: String(r.id), checked: rows.length };
    prev = r.hash;
  }
  return { ok: true, brokenAt: null, checked: rows.length };
}

/** Writes an event to the outbox in the caller's transaction. */
export async function publish(client: pg.PoolClient, topic: string, payload: Record<string, unknown>) {
  await client.query('INSERT INTO core.outbox (topic, payload) VALUES ($1, $2)', [topic, payload]);
}
