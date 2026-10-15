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

/** Like requireRole, for routes several roles may use (e.g. the audit log: admins and auditors). */
export function requireAnyRole(ctx: Ctx, roles: Role[]) {
  const user = requireUser(ctx);
  return async (req: FastifyRequest, reply: FastifyReply) => {
    await user(req, reply);
    if (!req.auth!.roles.some((r) => roles.includes(r))) throw forbidden();
  };
}

/**
 * preHandler for the ALT Command Centre's /staff routes: a staff role, a session signed in to the Command Centre
 * itself (platform 'admin', so a token from a phone app can't be used here) and, when configured,
 * 2FA on the account.
 */
export function requireStaff(ctx: Ctx) {
  const user = requireUser(ctx);
  return async (req: FastifyRequest, reply: FastifyReply) => {
    await user(req, reply);
    const a = req.auth!;
    if (!a.roles.some((r) => r === 'admin' || r === 'moderator' || r === 'support' || r === 'auditor')) throw forbidden();
    if (a.platform !== 'admin') throw forbidden('COMMAND_SESSION_REQUIRED', 'Sign in to the ALT Command Centre to do this.');
    if (ctx.config.staffRequire2fa) {
      const { rows } = await ctx.db.query<{ two_fa_enabled: boolean }>('SELECT two_fa_enabled FROM core.users WHERE id = $1', [a.userId]);
      if (!rows[0]?.two_fa_enabled) throw forbidden('STAFF_2FA_REQUIRED', 'Turn on two-factor authentication to use the ALT Command Centre.');
    }
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
