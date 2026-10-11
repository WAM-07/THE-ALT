import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Ctx, Role } from '../context.js';
import { safeEqual } from '../lib/crypto.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { isSessionActive } from '../modules/accounts/sessions.js';

export interface AuthInfo {
  userId: string;
  sessionId: string;
  platform: string;
  roles: Role[];
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthInfo;
    service?: string;
  }
}

export function bearer(req: FastifyRequest) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
}

/** preHandler: requires a valid access token whose session has not been revoked. */
export function requireUser(ctx: Ctx) {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const token = bearer(req);
    if (!token) throw unauthorized();
    const claims = await ctx.tokens.verifyAccess(token);
    // Checking the session makes "log out" and "log out everywhere" take effect immediately in Core.
    if (!(await isSessionActive(ctx.db, claims.sid))) {
      throw unauthorized('SESSION_REVOKED', 'You were signed out. Sign in again.');
    }
    req.auth = { userId: claims.sub, sessionId: claims.sid, platform: claims.plat, roles: claims.roles as Role[] };
  };
}

export function requireRole(ctx: Ctx, role: Role) {
  const user = requireUser(ctx);
  return async (req: FastifyRequest, reply: FastifyReply) => {
    await user(req, reply);
    if (!req.auth!.roles.includes(role)) throw forbidden();
  };
}

/** preHandler for /internal routes: only other ALT services, identified by the shared service key. */
export function requireService(ctx: Ctx) {
  return async (req: FastifyRequest) => {
    const key = req.headers['x-alt-service-key'];
    const name = req.headers['x-alt-service'];
    if (typeof key !== 'string' || typeof name !== 'string' || !safeEqual(key, ctx.config.internalServiceKey)) {
      throw unauthorized('SERVICE_UNAUTHORIZED', 'Service credentials required.');
    }
    req.service = name;
  };
}
