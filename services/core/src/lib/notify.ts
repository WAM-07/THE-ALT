import { EventEmitter } from 'node:events';
import pg from 'pg';
import type { Queryable } from '../db.js';

export const NOTIFICATIONS_CHANNEL = 'alt_notifications';

export type NotificationCategory = 'ai' | 'security' | 'moderation' | 'social' | 'transaction' | 'system';

export interface NewNotification {
  userId: string;
  category: NotificationCategory;
  type: string;
  title: string;
  body?: string | null;
  data?: Record<string, unknown>;
  platform?: 'core' | 'alter' | 'altera' | 'altar' | 'admin';
  link?: string | null;
}

/**
 * Adds a notification to a person's ALT inbox (Module 2). Call it inside the transaction that
 * caused it: the NOTIFY that pushes it to open apps is only delivered if that transaction commits.
 */
export async function notify(q: Queryable, n: NewNotification) {
  const { rows } = await q.query<{ id: string }>(
    `INSERT INTO core.notifications (user_id, category, type, title, body, data, platform, link)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [n.userId, n.category, n.type, n.title.slice(0, 140), n.body?.slice(0, 1000) ?? null, n.data ?? {}, n.platform ?? 'core', n.link ?? null],
  );
  await q.query('SELECT pg_notify($1, $2)', [NOTIFICATIONS_CHANNEL, JSON.stringify({ id: rows[0]!.id, userId: n.userId })]);
  return rows[0]!.id;
}

/**
 * Fans committed notifications out to people's open streams (Server-Sent Events). One database
 * connection per Core instance; each stream subscribes to its own user id.
 */
export class NotificationHub extends EventEmitter {
  private client: pg.Client | null = null;
  private stopped = false;

  constructor(private readonly databaseUrl: string) {
    super();
    this.setMaxListeners(0);
  }

  async start() {
    if (this.client || this.stopped) return;
    const client = new pg.Client({ connectionString: this.databaseUrl });
    this.client = client;
    client.on('notification', (msg) => {
      try {
        const { id, userId } = JSON.parse(msg.payload ?? '{}') as { id: string; userId: string };
        this.emit(`user:${userId}`, id);
        this.emit('notification', { id, userId });
      } catch {
        // ignore malformed payloads
      }
    });
    client.on('error', () => {
      this.client = null;
      if (!this.stopped) setTimeout(() => void this.start().catch(() => {}), 5000);
    });
    await client.connect();
    await client.query(`LISTEN ${NOTIFICATIONS_CHANNEL}`);
  }

  async stop() {
    this.stopped = true;
    const c = this.client;
    this.client = null;
    await c?.end().catch(() => {});
  }
}
