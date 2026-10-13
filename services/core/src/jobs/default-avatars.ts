import type { Ctx } from '../context.js';
import { tx } from '../db.js';
import { publish } from '../lib/audit.js';
import { defaultAvatar } from '../lib/avatars.js';

/**
 * Gives a ready-made picture to accounts and AIs created before ALT had them, so nobody shows a
 * blank circle. New ones get theirs when they are created; this only fills gaps and is safe to rerun.
 */
export async function assignDefaultAvatars(ctx: Ctx, log: (msg: string) => void) {
  const filled = await tx(ctx.db, async (client) => {
    const users = await client.query<{ id: string }>('SELECT id FROM core.users WHERE avatar_url IS NULL AND deleted_at IS NULL FOR UPDATE');
    for (const u of users.rows) {
      await client.query('UPDATE core.users SET avatar_url = $2 WHERE id = $1', [u.id, defaultAvatar(ctx, 'human', u.id)]);
      await publish(client, 'user.updated', { userId: u.id, fields: ['avatarUrl'] });
    }
    const ais = await client.query<{ id: string; status: string }>('SELECT id, status FROM core.personal_ais WHERE avatar_url IS NULL AND deleted_at IS NULL FOR UPDATE');
    for (const a of ais.rows) {
      await client.query('UPDATE core.personal_ais SET avatar_url = $2 WHERE id = $1', [a.id, defaultAvatar(ctx, 'ai', a.id)]);
      if (a.status === 'verified') {
        // ALTERA copies a verified AI's picture when it hears about the change.
        await publish(client, 'ai.updated', { aiId: a.id, fields: ['avatarUrl'] });
        await client.query(`SELECT pg_notify('alt_ai_events', $1)`, [JSON.stringify({ aiId: a.id, event: 'updated' })]);
      }
    }
    return users.rowCount! + ais.rowCount!;
  });
  if (filled) log(`gave ${filled} account(s) and AI(s) a ready-made picture`);
}
