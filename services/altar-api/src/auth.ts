import type { FastifyReply, FastifyRequest } from 'fastify';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type pg from 'pg';
import { AltarError } from './errors.js';

export interface Caller {
  userId: string;
  sessionId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    caller?: Caller;
  }
}

/**
 * ALTAR has no accounts of its own: it accepts ALT access tokens (RS256, checked with Core's public
 * keys) and checks that the session is still signed in, so signing out anywhere takes effect here
 * at once. The same rules as ALTERA's middleware.
 */
export function createAuth(opts: { db: pg.Pool; issuer: string; jwksUrl: string; keySet?: JWTVerifyGetKey }) {
  const keys = opts.keySet ?? createRemoteJWKSet(new URL(opts.jwksUrl), { cooldownDuration: 30_000 });
  const cache = new Map<string, { active: boolean; userId: string; until: number }>();

  /** Core announces sign-outs (Postgres NOTIFY on alt_sessions_revoked); forget those sessions at once. */
  function forget({ sessionId, userId }: { sessionId?: string; userId?: string }) {
    if (sessionId) cache.delete(sessionId);
    if (userId) for (const [id, s] of cache) if (s.userId === userId) cache.delete(id);
  }

  async function sessionActive(sessionId: string, userId: string) {
    const hit = cache.get(sessionId);
    if (hit && hit.until > Date.now()) return hit.active;
    const { rowCount } = await opts.db.query('SELECT 1 FROM core.sessions WHERE id = $1 AND revoked_at IS NULL AND expires_at > now()', [sessionId]);
    const active = Boolean(rowCount);
    cache.set(sessionId, { active, userId, until: Date.now() + (active ? 15_000 : 3_600_000) });
    if (cache.size > 10_000) cache.clear();
    return active;
  }

  async function caller(req: FastifyRequest): Promise<Caller> {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new AltarError(401, 'UNAUTHORIZED', 'Sign in with your ALT account.');
    let claims;
    try {
      ({ payload: claims } = await jwtVerify(header.slice(7), keys, { issuer: opts.issuer, audience: 'alt', algorithms: ['RS256'] }));
    } catch (err) {
      const expired = (err as { code?: string }).code === 'ERR_JWT_EXPIRED';
      throw new AltarError(401, expired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN', expired ? 'Your session expired.' : 'Sign in with your ALT account.');
    }
    const sessionId = String(claims.sid ?? '');
    if (!claims.sub || !sessionId || !(await sessionActive(sessionId, claims.sub))) throw new AltarError(401, 'SESSION_REVOKED', 'You were signed out. Sign in again.');
    return { userId: claims.sub, sessionId };
  }

  return {
    forget,
    /** preHandler for routes that need a signed-in person. */
    requireUser: async (req: FastifyRequest, _reply: FastifyReply) => {
      req.caller = await caller(req);
    },
  };
}
