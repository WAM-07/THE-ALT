import type pg from 'pg';
import type { Ctx, Platform } from '../../context.js';
import { tx } from '../../db.js';
import { audit } from '../../lib/audit.js';
import { randomToken, safeEqual, sha256 } from '../../lib/crypto.js';
import { unauthorized } from '../../lib/errors.js';
import { findUserById, touchPlatform, type UserRow } from './users.js';

export interface DeviceInfo {
  platform: Platform;
  deviceName?: string | undefined;
  userAgent?: string | undefined;
  ip?: string | undefined;
}

export interface TokenPair {
  tokenType: 'Bearer';
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  sessionId: string;
}

// Refresh tokens look like "<sessionId>.<secret>"; only sha256(secret) is stored.
const splitRefresh = (token: string) => {
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const sessionId = token.slice(0, dot);
  const secret = token.slice(dot + 1);
  return /^[0-9a-f-]{36}$/.test(sessionId) && secret.length >= 32 ? { sessionId, secret } : null;
};

async function accessFor(ctx: Ctx, user: UserRow, sessionId: string, platform: string) {
  return ctx.tokens.signAccess({ sub: user.id, sid: sessionId, plat: platform, roles: user.roles });
}

/** Creates a session for a user who has just proven who they are. Runs in the caller's transaction. */
export async function startSession(ctx: Ctx, client: pg.PoolClient, user: UserRow, device: DeviceInfo, method: string): Promise<TokenPair> {
  const secret = randomToken(32);
  const expiresAt = new Date(Date.now() + ctx.config.refreshTokenTtlDays * 86_400_000);
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO core.sessions (user_id, platform, device_name, user_agent, ip, refresh_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [user.id, device.platform, device.deviceName ?? null, device.userAgent ?? null, device.ip ?? null, sha256(secret), expiresAt],
  );
  const sessionId = rows[0]!.id;
  await client.query(
    'UPDATE core.users SET last_login_at = now(), failed_login_count = 0, locked_until = NULL WHERE id = $1',
    [user.id],
  );
  await touchPlatform(client, user.id, device.platform);
  await audit(client, {
    action: 'auth.session.started',
    actorUserId: user.id,
    entityType: 'session',
    entityId: sessionId,
    ip: device.ip ?? null,
    data: { platform: device.platform, method, device: device.deviceName ?? null },
  });
  return {
    tokenType: 'Bearer',
    accessToken: await accessFor(ctx, user, sessionId, device.platform),
    accessTokenExpiresIn: ctx.tokens.accessTokenTtl,
    refreshToken: `${sessionId}.${secret}`,
    refreshTokenExpiresAt: expiresAt.toISOString(),
    sessionId,
  };
}

/**
 * Exchanges a refresh token for a new pair. The old token stops working immediately.
 * If an already-rotated token is presented, someone copied it: the whole session is revoked.
 */
export async function rotateSession(ctx: Ctx, refreshToken: string, ip?: string) {
  const parts = splitRefresh(refreshToken);
  if (!parts) throw unauthorized('INVALID_REFRESH_TOKEN', 'Sign in again.');
  const hash = sha256(parts.secret);

  return tx(ctx.db, async (client) => {
    const { rows } = await client.query(
      'SELECT * FROM core.sessions WHERE id = $1 FOR UPDATE',
      [parts.sessionId],
    );
    const session = rows[0];
    if (!session || session.revoked_at || session.expires_at < new Date()) {
      throw unauthorized('INVALID_REFRESH_TOKEN', 'Sign in again.');
    }
    if (session.prev_refresh_hash && safeEqual(session.prev_refresh_hash, hash)) {
      await client.query(`UPDATE core.sessions SET revoked_at = now(), revoke_reason = 'refresh_reuse' WHERE id = $1`, [session.id]);
      await announceRevocation(client, { sessionId: session.id, userId: session.user_id });
      await audit(client, {
        action: 'auth.session.reuse_detected',
        actorUserId: session.user_id,
        entityType: 'session',
        entityId: session.id,
        ip: ip ?? null,
      });
      return { reused: true as const };
    }
    if (!safeEqual(session.refresh_hash, hash)) throw unauthorized('INVALID_REFRESH_TOKEN', 'Sign in again.');

    const user = await findUserById(client, session.user_id);
    if (!user) throw unauthorized('INVALID_REFRESH_TOKEN', 'Sign in again.');

    const secret = randomToken(32);
    const expiresAt = new Date(Date.now() + ctx.config.refreshTokenTtlDays * 86_400_000);
    await client.query(
      `UPDATE core.sessions
          SET prev_refresh_hash = refresh_hash, refresh_hash = $2, last_used_at = now(), expires_at = $3, ip = COALESCE($4, ip)
        WHERE id = $1`,
      [session.id, sha256(secret), expiresAt, ip ?? null],
    );
    await touchPlatform(client, user.id, session.platform);
    const pair: TokenPair = {
      tokenType: 'Bearer',
      accessToken: await accessFor(ctx, user, session.id, session.platform),
      accessTokenExpiresIn: ctx.tokens.accessTokenTtl,
      refreshToken: `${session.id}.${secret}`,
      refreshTokenExpiresAt: expiresAt.toISOString(),
      sessionId: session.id,
    };
    return { reused: false as const, pair, user };
  }).then((result) => {
    // The revocation above must commit before we refuse, so throw outside the transaction.
    if (result.reused) throw unauthorized('REFRESH_TOKEN_REUSED', 'This session was signed out for your safety. Sign in again.');
    return result;
  });
}

/**
 * Tells every ALT service, the moment the transaction commits, that sessions ended
 * (Postgres NOTIFY is transactional). Services drop cached tokens and close sockets at once.
 */
export const SESSIONS_CHANNEL = 'alt_sessions_revoked';
async function announceRevocation(client: pg.PoolClient, payload: { sessionId?: string; userId?: string }) {
  await client.query('SELECT pg_notify($1, $2)', [SESSIONS_CHANNEL, JSON.stringify(payload)]);
}

export async function revokeSession(client: pg.PoolClient, userId: string, sessionId: string, reason: string) {
  const { rowCount } = await client.query(
    `UPDATE core.sessions SET revoked_at = now(), revoke_reason = $3 WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [sessionId, userId, reason],
  );
  if (rowCount) await announceRevocation(client, { sessionId, userId });
  return (rowCount ?? 0) > 0;
}

export async function revokeAllSessions(client: pg.PoolClient, userId: string, reason: string, exceptSessionId?: string) {
  const { rowCount } = await client.query(
    `UPDATE core.sessions SET revoked_at = now(), revoke_reason = $2
      WHERE user_id = $1 AND revoked_at IS NULL AND ($3::uuid IS NULL OR id <> $3::uuid)`,
    [userId, reason, exceptSessionId ?? null],
  );
  if (rowCount) await announceRevocation(client, { userId });
  return rowCount ?? 0;
}

export async function isSessionActive(q: pg.Pool | pg.PoolClient, sessionId: string) {
  const { rowCount } = await q.query(
    'SELECT 1 FROM core.sessions WHERE id = $1 AND revoked_at IS NULL AND expires_at > now()',
    [sessionId],
  );
  return (rowCount ?? 0) > 0;
}
