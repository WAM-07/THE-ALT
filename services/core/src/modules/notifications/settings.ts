import type { Ctx } from '../../context.js';
import { ALWAYS_ON, type NotificationCategory } from '../../lib/notify.js';

/** Module 2: what a person wants to hear about, and the e-mail digest of what they have not read. */

export const MUTABLE: NotificationCategory[] = ['ai', 'moderation', 'social', 'transaction'];
export type Digest = 'off' | 'daily' | 'weekly';

export async function notificationSettings(ctx: Ctx, userId: string) {
  const { rows } = await ctx.db.query<{ muted: string[]; push_muted: string[]; digest: Digest; last_digest_at: Date | null }>(
    'SELECT muted, push_muted, digest, last_digest_at FROM core.notification_settings WHERE user_id = $1',
    [userId],
  );
  const s = rows[0];
  return {
    categories: MUTABLE.map((c) => ({ category: c, inbox: !s?.muted.includes(c), push: !s?.push_muted.includes(c) })),
    alwaysOn: ALWAYS_ON,
    digest: s?.digest ?? 'off',
    lastDigestAt: s?.last_digest_at?.toISOString() ?? null,
  };
}

export async function saveNotificationSettings(ctx: Ctx, userId: string, input: { muted: string[]; pushMuted: string[]; digest: Digest }) {
  const keep = (list: string[]) => [...new Set(list)].filter((c): c is NotificationCategory => MUTABLE.includes(c as NotificationCategory));
  await ctx.db.query(
    `INSERT INTO core.notification_settings (user_id, muted, push_muted, digest) VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id) DO UPDATE SET muted = EXCLUDED.muted, push_muted = EXCLUDED.push_muted, digest = EXCLUDED.digest, updated_at = now()`,
    [userId, keep(input.muted), keep(input.pushMuted), input.digest],
  );
  return notificationSettings(ctx, userId);
}

/**
 * Sends the e-mail digests that are due: everyone with a daily (or weekly) digest gets what they have not
 * read since the last one, at most once a day (or a week). Nothing to say, no e-mail.
 */
export async function sendDigests(ctx: Ctx) {
  const { rows: due } = await ctx.db.query<{ user_id: string; email: string; display_name: string; digest: Digest; since: Date }>(
    `SELECT s.user_id, u.email, u.display_name, s.digest, COALESCE(s.last_digest_at, now() - interval '7 days') AS since
       FROM core.notification_settings s JOIN core.users u ON u.id = s.user_id
      WHERE s.digest <> 'off' AND u.deleted_at IS NULL AND u.email IS NOT NULL
        AND (s.last_digest_at IS NULL OR s.last_digest_at < now() - CASE s.digest WHEN 'daily' THEN interval '23 hours' ELSE interval '167 hours' END)`,
  );
  let sent = 0;
  for (const d of due) {
    const { rows: unread } = await ctx.db.query<{ title: string; body: string | null; created_at: Date }>(
      `SELECT title, body, created_at FROM core.notifications WHERE user_id = $1 AND read_at IS NULL AND created_at > $2 ORDER BY created_at DESC LIMIT 30`,
      [d.user_id, d.since],
    );
    if (unread.length) {
      await ctx.mailer.send({
        to: d.email,
        subject: `Your ALT ${d.digest} digest: ${unread.length} unread`,
        text: [
          `Hi ${d.display_name},`,
          '',
          `Here is what happened in The ALT Ecosystem that you have not read yet:`,
          '',
          ...unread.map((n) => `- ${n.title}${n.body ? `: ${n.body}` : ''} (${n.created_at.toISOString().slice(0, 10)})`),
          '',
          `Open ALTER, ALTERA or ALTAR to see them. Change or stop this digest in your ALT inbox settings.`,
        ].join('\n'),
      });
      sent++;
    }
    await ctx.db.query('UPDATE core.notification_settings SET last_digest_at = now() WHERE user_id = $1', [d.user_id]);
  }
  return sent;
}

export function startDigests(ctx: Ctx, warn: (msg: string) => void) {
  const run = async () => {
    const client = await ctx.db.connect();
    try {
      const { rows } = await client.query<{ ok: boolean }>(`SELECT pg_try_advisory_lock(hashtext('core.digests')) AS ok`);
      if (!rows[0]?.ok) return;
      try {
        await sendDigests(ctx);
      } finally {
        await client.query(`SELECT pg_advisory_unlock(hashtext('core.digests'))`);
      }
    } finally {
      client.release();
    }
  };
  const go = () => void run().catch((err: Error) => warn(`digests: ${err.message}`));
  const first = setTimeout(go, 120_000);
  const timer = setInterval(go, 3600_000);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
