import bcrypt from 'bcryptjs';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Ctx, Platform as PlatformT } from '../../context.js';
import { tx } from '../../db.js';
import { audit } from '../../lib/audit.js';
import { notify } from '../../lib/notify.js';
import { decrypt, encrypt, randomToken, safeEqual, sha256 } from '../../lib/crypto.js';
import { AppError, badRequest, conflict, unauthorized } from '../../lib/errors.js';
import { generateTotpSecret, totpUri, verifyTotp } from '../../lib/totp.js';
import { issueOtp, sendOtpMail, verifyOtp } from '../../modules/accounts/otp.js';
import { revokeAllSessions, revokeSession, rotateSession, startSession, type TokenPair } from '../../modules/accounts/sessions.js';
import { consumeSiwe, createSiweNonce } from '../../modules/accounts/siwe.js';
import {
  createUser,
  findUserByEmail,
  findUserById,
  findUserByLogin,
  loadMe,
  uniqueHandle,
  type UserRow,
} from '../../modules/accounts/users.js';
import { requireUser } from '../auth-guard.js';
import { DeviceFields, DisplayName, Email, Handle, OtpCode, Password, Platform, SelfRole } from '../schemas.js';

const BCRYPT_ROUNDS = 12;
const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MS = 30 * 60_000;
// Compared against when the account does not exist, so response time does not reveal which emails are registered.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_ROUNDS);

export const REFRESH_COOKIE = 'alt_rt';
const COOKIE_PATH = '/core/auth';

const loginLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } };
const strictLimit = { rateLimit: { max: 5, timeWindow: '1 minute' } };

const deviceOf = (req: FastifyRequest, platform: PlatformT, deviceName?: string) => ({
  platform,
  deviceName,
  userAgent: req.headers['user-agent'],
  ip: req.ip,
});

export async function authRoutes(app: FastifyInstance, ctx: Ctx) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const authed = requireUser(ctx);

  /** Web clients keep the refresh token in an httpOnly cookie; apps keep it in secure storage. */
  async function sendTokens(reply: FastifyReply, pair: TokenPair, user: UserRow, client: 'app' | 'web', status = 200) {
    const me = await loadMe(ctx.db, user);
    if (client === 'web') {
      reply.setCookie(REFRESH_COOKIE, pair.refreshToken, {
        httpOnly: true,
        secure: ctx.config.isProd,
        sameSite: 'lax',
        path: COOKIE_PATH,
        expires: new Date(pair.refreshTokenExpiresAt),
      });
      const { refreshToken: _omit, ...rest } = pair;
      return reply.status(status).send({ ...rest, user: me });
    }
    return reply.status(status).send({ ...pair, user: me });
  }

  /** Counts a failed sign-in in its own transaction (it must survive the error we throw next). */
  async function recordFailure(user: UserRow, ip: string, reason: string) {
    const locked = await tx(ctx.db, async (client) => {
      const { rows } = await client.query<{ failed_login_count: number }>(
        'UPDATE core.users SET failed_login_count = failed_login_count + 1 WHERE id = $1 RETURNING failed_login_count',
        [user.id],
      );
      const count = rows[0]!.failed_login_count;
      if (count >= MAX_FAILED_LOGINS) {
        const until = new Date(Date.now() + LOCKOUT_MS);
        await client.query('UPDATE core.users SET failed_login_count = 0, locked_until = $2 WHERE id = $1', [user.id, until]);
        await audit(client, { action: 'auth.lockout', actorUserId: user.id, entityType: 'user', entityId: user.id, ip, data: { reason } });
        await notify(client, {
          userId: user.id,
          category: 'security',
          type: 'security.locked',
          title: 'Your account was locked for 30 minutes',
          body: 'There were 5 failed sign-in attempts. If this was not you, change your password once you can sign in again.',
        });
        return until;
      }
      await audit(client, { action: 'auth.login.failed', actorUserId: user.id, entityType: 'user', entityId: user.id, ip, data: { reason } });
      return null;
    });
    if (locked) throw lockedError(locked);
  }

  const lockedError = (until: Date) =>
    new AppError(423, 'ACCOUNT_LOCKED', 'Too many failed attempts. Try again later.', { lockedUntil: until.toISOString() });

  function assertNotLocked(user: UserRow) {
    if (user.locked_until && user.locked_until > new Date()) throw lockedError(user.locked_until);
  }

  /** After the first factor: either finish sign-in, or ask for the 2FA code. */
  async function completeSignIn(
    req: FastifyRequest,
    reply: FastifyReply,
    user: UserRow,
    body: { platform: PlatformT; deviceName?: string | undefined; client: 'app' | 'web' },
    method: string,
  ) {
    if (user.two_fa_enabled) {
      const mfaToken = await ctx.tokens.signMfa(user.id, body.platform, body.deviceName);
      return reply.send({ mfaRequired: true, mfaToken, methods: ['totp', 'recovery_code'] });
    }
    const pair = await tx(ctx.db, (client) => startSession(ctx, client, user, deviceOf(req, body.platform, body.deviceName), method));
    return sendTokens(reply, pair, user, body.client);
  }

  // ---------------------------------------------------------------- registration & email

  r.post(
    '/auth/register',
    {
      config: strictLimit,
      schema: {
        tags: ['auth'],
        summary: 'Create an ALT account (works for ALTER, ALTAR and ALTERA)',
        body: z.object({
          email: Email,
          password: Password,
          handle: Handle,
          displayName: DisplayName,
          roles: z.array(SelfRole).max(3).optional(),
        }),
      },
    },
    async (req, reply) => {
      const b = req.body;
      const passwordHash = await bcrypt.hash(b.password, BCRYPT_ROUNDS);
      const { user, code } = await tx(ctx.db, async (client) => {
        const user = await createUser(ctx, client, {
          handle: b.handle,
          displayName: b.displayName,
          email: b.email,
          passwordHash,
          roles: b.roles,
        });
        await audit(client, {
          action: 'account.registered',
          actorUserId: user.id,
          entityType: 'user',
          entityId: user.id,
          ip: req.ip,
          data: { method: 'password' },
        });
        const code = await issueOtp(ctx, client, user.id, b.email, 'verify_email');
        return { user, code };
      });
      await sendOtpMail(ctx, b.email, 'verify_email', code);
      return reply.status(201).send({ userId: user.id, email: b.email, verificationRequired: true });
    },
  );

  r.post(
    '/auth/email/verify',
    {
      config: strictLimit,
      schema: {
        tags: ['auth'],
        summary: 'Confirm the email code; signs the user in',
        body: z.object({ email: Email, code: OtpCode, ...DeviceFields }),
      },
    },
    async (req, reply) => {
      const b = req.body;
      const userId = await verifyOtp(ctx, b.email, 'verify_email', b.code);
      const user = await tx(ctx.db, async (client) => {
        await client.query('UPDATE core.users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1', [userId]);
        await audit(client, { action: 'account.email_verified', actorUserId: userId, entityType: 'user', entityId: userId, ip: req.ip });
        return findUserById(client, userId);
      });
      if (!user) throw unauthorized();
      return completeSignIn(req, reply, user, b, 'email_verification');
    },
  );

  r.post(
    '/auth/otp/resend',
    {
      config: strictLimit,
      schema: {
        tags: ['auth'],
        summary: 'Send a new email verification code',
        body: z.object({ email: Email }),
      },
    },
    async (req, reply) => {
      const user = await findUserByEmail(ctx.db, req.body.email);
      if (user && !user.email_verified_at) {
        try {
          const code = await tx(ctx.db, (client) => issueOtp(ctx, client, user.id, req.body.email, 'verify_email'));
          await sendOtpMail(ctx, req.body.email, 'verify_email', code);
        } catch (err) {
          if (!(err instanceof AppError && err.code === 'OTP_COOLDOWN')) throw err;
        }
      }
      // Same answer whether or not the account exists (and during the resend cooldown).
      return reply.send({ sent: true });
    },
  );

  // ---------------------------------------------------------------- password sign-in

  r.post(
    '/auth/login',
    {
      config: loginLimit,
      schema: {
        tags: ['auth'],
        summary: 'Sign in with email or handle and password',
        body: z.object({ identifier: z.string().min(1).max(254), password: z.string().min(1).max(128), ...DeviceFields }),
      },
    },
    async (req, reply) => {
      const b = req.body;
      const user = await findUserByLogin(ctx.db, b.identifier.trim().toLowerCase());
      if (!user || !user.password_hash) {
        await bcrypt.compare(b.password, DUMMY_HASH);
        throw unauthorized('INVALID_CREDENTIALS', 'Wrong email/handle or password.');
      }
      assertNotLocked(user);
      if (!(await bcrypt.compare(b.password, user.password_hash))) {
        await recordFailure(user, req.ip, 'password');
        throw unauthorized('INVALID_CREDENTIALS', 'Wrong email/handle or password.');
      }
      if (user.email && !user.email_verified_at) {
        try {
          const code = await tx(ctx.db, (client) => issueOtp(ctx, client, user.id, user.email!, 'verify_email'));
          await sendOtpMail(ctx, user.email, 'verify_email', code);
        } catch (err) {
          if (!(err instanceof AppError && err.code === 'OTP_COOLDOWN')) throw err;
        }
        throw new AppError(403, 'EMAIL_NOT_VERIFIED', 'Verify your email first. We sent you a code.', { email: user.email });
      }
      return completeSignIn(req, reply, user, b, 'password');
    },
  );

  r.post(
    '/auth/login/2fa',
    {
      config: loginLimit,
      schema: {
        tags: ['auth'],
        summary: 'Second step of sign-in when two-factor authentication is on',
        body: z
          .object({
            mfaToken: z.string().min(1),
            code: OtpCode.optional(),
            recoveryCode: z.string().min(8).max(20).optional(),
            client: DeviceFields.client,
          })
          .refine((b) => Boolean(b.code) !== Boolean(b.recoveryCode), 'Send either code or recoveryCode'),
      },
    },
    async (req, reply) => {
      const b = req.body;
      const mfa = await ctx.tokens.verifyMfa(b.mfaToken);
      const user = await findUserById(ctx.db, mfa.userId);
      if (!user || !user.two_fa_enabled || !user.two_fa_secret_enc) throw unauthorized('MFA_EXPIRED', 'Start signing in again.');
      assertNotLocked(user);

      const accepted = await tx(ctx.db, async (client) => {
        if (b.code) {
          const step = verifyTotp(decrypt(ctx.config.encryptionKey, user.two_fa_secret_enc!), b.code);
          if (step === null || (user.two_fa_last_step && step <= Number(user.two_fa_last_step))) return false;
          await client.query('UPDATE core.users SET two_fa_last_step = $2 WHERE id = $1', [user.id, step]);
          return true;
        }
        return useRecoveryCode(client, user.id, b.recoveryCode!);
      });
      if (!accepted) {
        await recordFailure(user, req.ip, '2fa');
        throw unauthorized('MFA_CODE_INVALID', 'That code is not valid.');
      }
      const pair = await tx(ctx.db, (client) =>
        startSession(ctx, client, user, deviceOf(req, mfa.platform as PlatformT, mfa.device), b.code ? 'password+totp' : 'password+recovery'),
      );
      return sendTokens(reply, pair, user, b.client);
    },
  );

  // ---------------------------------------------------------------- tokens & sign-out

  r.post(
    '/auth/refresh',
    {
      schema: {
        tags: ['auth'],
        summary: 'Swap a refresh token for a new token pair (the old one stops working)',
        body: z.object({ refreshToken: z.string().optional() }).optional(),
      },
    },
    async (req, reply) => {
      const fromCookie = req.cookies[REFRESH_COOKIE];
      const token = req.body?.refreshToken ?? fromCookie;
      if (!token) throw unauthorized('INVALID_REFRESH_TOKEN', 'Sign in again.');
      const { pair, user } = await rotateSession(ctx, token, req.ip);
      return sendTokens(reply, pair, user, req.body?.refreshToken ? 'app' : 'web');
    },
  );

  r.post('/auth/logout', { preHandler: authed, schema: { tags: ['auth'], summary: 'Sign out of this device' } }, async (req, reply) => {
    await tx(ctx.db, async (client) => {
      await revokeSession(client, req.auth!.userId, req.auth!.sessionId, 'logout');
      await audit(client, { action: 'auth.logout', actorUserId: req.auth!.userId, entityType: 'session', entityId: req.auth!.sessionId, ip: req.ip });
    });
    reply.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH });
    return reply.send({ ok: true });
  });

  r.post(
    '/auth/logout-all',
    { preHandler: authed, schema: { tags: ['auth'], summary: 'Sign out of every device and app' } },
    async (req, reply) => {
      const count = await tx(ctx.db, async (client) => {
        const n = await revokeAllSessions(client, req.auth!.userId, 'logout_all');
        await audit(client, { action: 'auth.logout_all', actorUserId: req.auth!.userId, entityType: 'user', entityId: req.auth!.userId, ip: req.ip, data: { sessions: n } });
        return n;
      });
      reply.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH });
      return reply.send({ ok: true, sessionsRevoked: count });
    },
  );

  // ---------------------------------------------------------------- passwords

  r.post(
    '/auth/password/forgot',
    { config: strictLimit, schema: { tags: ['auth'], summary: 'Email a password reset code', body: z.object({ email: Email }) } },
    async (req, reply) => {
      const user = await findUserByEmail(ctx.db, req.body.email);
      if (user) {
        try {
          const code = await tx(ctx.db, (client) => issueOtp(ctx, client, user.id, req.body.email, 'reset_password'));
          await sendOtpMail(ctx, req.body.email, 'reset_password', code);
        } catch (err) {
          if (!(err instanceof AppError && err.code === 'OTP_COOLDOWN')) throw err;
        }
      }
      return reply.send({ sent: true });
    },
  );

  r.post(
    '/auth/password/reset',
    {
      config: strictLimit,
      schema: {
        tags: ['auth'],
        summary: 'Set a new password with the emailed code; signs out every device',
        body: z.object({ email: Email, code: OtpCode, newPassword: Password }),
      },
    },
    async (req, reply) => {
      const userId = await verifyOtp(ctx, req.body.email, 'reset_password', req.body.code);
      const hash = await bcrypt.hash(req.body.newPassword, BCRYPT_ROUNDS);
      await tx(ctx.db, async (client) => {
        await client.query(
          `UPDATE core.users SET password_hash = $2, failed_login_count = 0, locked_until = NULL,
                  email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1`,
          [userId, hash],
        );
        await revokeAllSessions(client, userId, 'password_reset');
        await audit(client, { action: 'account.password_reset', actorUserId: userId, entityType: 'user', entityId: userId, ip: req.ip });
        await notify(client, { userId, category: 'security', type: 'security.password_reset', title: 'Your password was reset', body: 'All devices were signed out.' });
      });
      return reply.send({ ok: true });
    },
  );

  r.post(
    '/auth/password/change',
    {
      preHandler: authed,
      config: strictLimit,
      schema: {
        tags: ['auth'],
        summary: 'Change (or set) the password; signs out other devices',
        body: z.object({ currentPassword: z.string().max(128).optional(), newPassword: Password }),
      },
    },
    async (req, reply) => {
      const user = await findUserById(ctx.db, req.auth!.userId);
      if (!user) throw unauthorized();
      if (user.password_hash) {
        if (!req.body.currentPassword || !(await bcrypt.compare(req.body.currentPassword, user.password_hash))) {
          await recordFailure(user, req.ip, 'password_change');
          throw unauthorized('INVALID_CREDENTIALS', 'Your current password is wrong.');
        }
      }
      const hash = await bcrypt.hash(req.body.newPassword, BCRYPT_ROUNDS);
      const revoked = await tx(ctx.db, async (client) => {
        await client.query('UPDATE core.users SET password_hash = $2 WHERE id = $1', [user.id, hash]);
        const n = await revokeAllSessions(client, user.id, 'password_change', req.auth!.sessionId);
        await audit(client, { action: 'account.password_changed', actorUserId: user.id, entityType: 'user', entityId: user.id, ip: req.ip });
        await notify(client, { userId: user.id, category: 'security', type: 'security.password_changed', title: 'Your password was changed', body: 'Other devices were signed out.' });
        return n;
      });
      return reply.send({ ok: true, otherSessionsRevoked: revoked });
    },
  );

  // ---------------------------------------------------------------- two-factor authentication

  r.post('/auth/2fa/setup', { preHandler: authed, schema: { tags: ['2fa'], summary: 'Start enabling 2FA; returns the secret for an authenticator app' } }, async (req, reply) => {
    const user = await findUserById(ctx.db, req.auth!.userId);
    if (!user) throw unauthorized();
    if (user.two_fa_enabled) throw conflict('2FA_ALREADY_ENABLED', 'Two-factor authentication is already on.');
    const secret = generateTotpSecret();
    await ctx.db.query('UPDATE core.users SET two_fa_pending_secret_enc = $2 WHERE id = $1', [user.id, encrypt(ctx.config.encryptionKey, secret)]);
    return reply.send({ secret, otpauthUrl: totpUri(secret, user.email ?? user.handle) });
  });

  r.post(
    '/auth/2fa/enable',
    { preHandler: authed, schema: { tags: ['2fa'], summary: 'Confirm the first code; turns 2FA on and returns recovery codes', body: z.object({ code: OtpCode }) } },
    async (req, reply) => {
      const user = await findUserById(ctx.db, req.auth!.userId);
      if (!user) throw unauthorized();
      if (user.two_fa_enabled) throw conflict('2FA_ALREADY_ENABLED', 'Two-factor authentication is already on.');
      if (!user.two_fa_pending_secret_enc) throw badRequest('2FA_NOT_STARTED', 'Start 2FA setup first.');
      const secret = decrypt(ctx.config.encryptionKey, user.two_fa_pending_secret_enc);
      const step = verifyTotp(secret, req.body.code);
      if (step === null) throw badRequest('MFA_CODE_INVALID', 'That code is not valid. Check your phone clock and try again.');
      const recoveryCodes = await tx(ctx.db, async (client) => {
        await client.query(
          `UPDATE core.users SET two_fa_enabled = true, two_fa_secret_enc = two_fa_pending_secret_enc,
                  two_fa_pending_secret_enc = NULL, two_fa_last_step = $2 WHERE id = $1`,
          [user.id, step],
        );
        const codes = await replaceRecoveryCodes(client, user.id);
        await audit(client, { action: 'account.2fa_enabled', actorUserId: user.id, entityType: 'user', entityId: user.id, ip: req.ip });
        await notify(client, { userId: user.id, category: 'security', type: 'security.2fa_on', title: 'Two-factor authentication is on', body: 'Signing in now also needs a code from your authenticator app.' });
        return codes;
      });
      return reply.send({ enabled: true, recoveryCodes });
    },
  );

  const SecondFactor = z
    .object({ code: OtpCode.optional(), recoveryCode: z.string().min(8).max(20).optional() })
    .refine((b) => Boolean(b.code) !== Boolean(b.recoveryCode), 'Send either code or recoveryCode');

  /** Re-checks the second factor for sensitive 2FA changes. */
  async function checkSecondFactor(client: import('pg').PoolClient, user: UserRow, b: z.infer<typeof SecondFactor>) {
    if (b.code) {
      const step = verifyTotp(decrypt(ctx.config.encryptionKey, user.two_fa_secret_enc!), b.code);
      if (step === null || (user.two_fa_last_step && step <= Number(user.two_fa_last_step))) return false;
      await client.query('UPDATE core.users SET two_fa_last_step = $2 WHERE id = $1', [user.id, step]);
      return true;
    }
    return useRecoveryCode(client, user.id, b.recoveryCode!);
  }

  r.post(
    '/auth/2fa/disable',
    { preHandler: authed, config: strictLimit, schema: { tags: ['2fa'], summary: 'Turn 2FA off (needs a current code)', body: SecondFactor } },
    async (req, reply) => {
      const user = await findUserById(ctx.db, req.auth!.userId);
      if (!user) throw unauthorized();
      if (!user.two_fa_enabled) throw badRequest('2FA_NOT_ENABLED', 'Two-factor authentication is not on.');
      const ok = await tx(ctx.db, async (client) => {
        if (!(await checkSecondFactor(client, user, req.body))) return false;
        await client.query(
          `UPDATE core.users SET two_fa_enabled = false, two_fa_secret_enc = NULL, two_fa_last_step = NULL WHERE id = $1`,
          [user.id],
        );
        await client.query('DELETE FROM core.two_fa_recovery_codes WHERE user_id = $1', [user.id]);
        await audit(client, { action: 'account.2fa_disabled', actorUserId: user.id, entityType: 'user', entityId: user.id, ip: req.ip });
        await notify(client, { userId: user.id, category: 'security', type: 'security.2fa_off', title: 'Two-factor authentication was turned off', body: 'If this was not you, turn it back on and change your password.' });
        return true;
      });
      if (!ok) throw unauthorized('MFA_CODE_INVALID', 'That code is not valid.');
      return reply.send({ enabled: false });
    },
  );

  r.post(
    '/auth/2fa/recovery-codes',
    { preHandler: authed, config: strictLimit, schema: { tags: ['2fa'], summary: 'Replace all recovery codes (needs a current code)', body: SecondFactor } },
    async (req, reply) => {
      const user = await findUserById(ctx.db, req.auth!.userId);
      if (!user?.two_fa_enabled) throw badRequest('2FA_NOT_ENABLED', 'Two-factor authentication is not on.');
      const codes = await tx(ctx.db, async (client) => {
        if (!(await checkSecondFactor(client, user, req.body))) return null;
        const c = await replaceRecoveryCodes(client, user.id);
        await audit(client, { action: 'account.2fa_recovery_regenerated', actorUserId: user.id, entityType: 'user', entityId: user.id, ip: req.ip });
        return c;
      });
      if (!codes) throw unauthorized('MFA_CODE_INVALID', 'That code is not valid.');
      return reply.send({ recoveryCodes: codes });
    },
  );

  // ---------------------------------------------------------------- Google

  r.post(
    '/auth/google',
    {
      config: loginLimit,
      schema: { tags: ['auth'], summary: 'Sign in or sign up with a Google ID token', body: z.object({ idToken: z.string().min(1), ...DeviceFields }) },
    },
    async (req, reply) => {
      const g = await ctx.google.verify(req.body.idToken);
      const user = await tx(ctx.db, async (client) => {
        const linked = await client.query<{ user_id: string }>(
          `SELECT user_id FROM core.auth_identities WHERE provider = 'google' AND subject = $1`,
          [g.sub],
        );
        if (linked.rows[0]) return findUserById(client, linked.rows[0].user_id);
        if (!g.email || !g.emailVerified) {
          throw unauthorized('GOOGLE_EMAIL_UNVERIFIED', 'Your Google account email is not verified.');
        }
        let user = await findUserByEmail(client, g.email);
        if (user) {
          if (!user.email_verified_at) {
            // Someone registered this email without proving they own it. Google just proved the real
            // owner is here, so drop that unverified password and any sessions it created.
            await client.query('UPDATE core.users SET password_hash = NULL, email_verified_at = now() WHERE id = $1', [user.id]);
            await revokeAllSessions(client, user.id, 'unverified_account_claimed');
          }
        } else {
          const handle = await uniqueHandle(client, g.name ?? g.email.split('@')[0]!);
          user = await createUser(ctx, client, {
            handle,
            displayName: (g.name ?? g.email.split('@')[0]!).slice(0, 80),
            email: g.email,
            emailVerified: true,
          });
          if (g.picture) await client.query('UPDATE core.users SET avatar_url = $2 WHERE id = $1', [user.id, g.picture]);
          await audit(client, { action: 'account.registered', actorUserId: user.id, entityType: 'user', entityId: user.id, ip: req.ip, data: { method: 'google' } });
        }
        await client.query(`INSERT INTO core.auth_identities (user_id, provider, subject, email) VALUES ($1, 'google', $2, $3)`, [
          user.id,
          g.sub,
          g.email,
        ]);
        await audit(client, { action: 'account.identity_linked', actorUserId: user.id, entityType: 'user', entityId: user.id, ip: req.ip, data: { provider: 'google' } });
        return findUserById(client, user.id);
      });
      if (!user) throw unauthorized();
      assertNotLocked(user);
      return completeSignIn(req, reply, user, req.body, 'google');
    },
  );

  // ---------------------------------------------------------------- Sign-In With Ethereum

  r.get(
    '/auth/siwe/nonce',
    { config: loginLimit, schema: { tags: ['auth'], summary: 'Get a nonce for a Sign-In With Ethereum message' } },
    async (_req, reply) => {
      const n = await createSiweNonce(ctx.db, 'login', null);
      return reply.send({ ...n, domain: ctx.config.publicHost, uri: ctx.config.publicUrl, statement: 'Sign in to THE ALT.' });
    },
  );

  r.post(
    '/auth/siwe/login',
    {
      config: loginLimit,
      schema: {
        tags: ['auth'],
        summary: 'Sign in (or sign up) with a wallet signature (EIP-4361)',
        body: z.object({ message: z.string().min(1).max(4000), signature: z.string().regex(/^0x[0-9a-fA-F]+$/), ...DeviceFields }),
      },
    },
    async (req, reply) => {
      const b = req.body;
      const user = await tx(ctx.db, async (client) => {
        const address = await consumeSiwe(ctx, client, b.message, b.signature, 'login', null);
        const existing = await client.query<{ user_id: string }>(
          `SELECT user_id FROM core.wallets WHERE address = $1 AND kind = 'external'`,
          [address],
        );
        if (existing.rows[0]) return findUserById(client, existing.rows[0].user_id);
        const custodialClash = await client.query(`SELECT 1 FROM core.wallets WHERE address = $1`, [address]);
        if (custodialClash.rowCount) throw conflict('WALLET_IN_USE', 'This address belongs to an ALT-managed wallet.');

        const user = await createUser(ctx, client, {
          handle: await uniqueHandle(client, `wallet_${address.slice(2, 8)}`),
          displayName: `${address.slice(0, 6)}…${address.slice(-4)}`,
        });
        await client.query('UPDATE core.wallets SET is_primary = false WHERE user_id = $1', [user.id]);
        await client.query(
          `INSERT INTO core.wallets (user_id, address, kind, is_primary, label) VALUES ($1, $2, 'external', true, 'Signed-in wallet')`,
          [user.id, address],
        );
        await audit(client, { action: 'account.registered', actorUserId: user.id, entityType: 'user', entityId: user.id, ip: req.ip, data: { method: 'siwe', address } });
        return user;
      });
      if (!user) throw unauthorized();
      assertNotLocked(user);
      return completeSignIn(req, reply, user, b, 'siwe');
    },
  );

  // ---------------------------------------------------------------- moving between ALT apps

  r.post(
    '/auth/handoff',
    {
      preHandler: authed,
      schema: {
        tags: ['auth'],
        summary: 'Get a one-time link that signs this user into another ALT app',
        body: z.object({ target: Platform }),
      },
    },
    async (req, reply) => {
      const code = randomToken(32);
      await tx(ctx.db, async (client) => {
        await client.query(
          `INSERT INTO core.handoff_codes (code_hash, user_id, source_session_id, target, expires_at)
           VALUES ($1, $2, $3, $4, now() + interval '60 seconds')`,
          [sha256(code), req.auth!.userId, req.auth!.sessionId, req.body.target],
        );
        await audit(client, {
          action: 'auth.handoff.created',
          actorUserId: req.auth!.userId,
          entityType: 'session',
          entityId: req.auth!.sessionId,
          ip: req.ip,
          data: { from: req.auth!.platform, to: req.body.target },
        });
      });
      const base = ctx.config.deepLinks[req.body.target];
      return reply.send({ code, expiresIn: 60, url: `${base}?code=${encodeURIComponent(code)}` });
    },
  );

  r.post(
    '/auth/handoff/redeem',
    {
      config: loginLimit,
      schema: {
        tags: ['auth'],
        summary: 'Exchange a handoff code for a session in this app',
        body: z.object({ code: z.string().min(20).max(100), ...DeviceFields }),
      },
    },
    async (req, reply) => {
      const b = req.body;
      const { user, pair } = await tx(ctx.db, async (client) => {
        const { rows } = await client.query<{ user_id: string }>(
          `UPDATE core.handoff_codes SET used_at = now()
            WHERE code_hash = $1 AND used_at IS NULL AND expires_at > now() AND target = $2
            RETURNING user_id`,
          [sha256(b.code), b.platform],
        );
        if (!rows[0]) throw unauthorized('HANDOFF_INVALID', 'This link has expired or was already used. Open it again from the other app.');
        const user = await findUserById(client, rows[0].user_id);
        if (!user) throw unauthorized('HANDOFF_INVALID', 'This account is no longer available.');
        assertNotLocked(user);
        const pair = await startSession(ctx, client, user, deviceOf(req, b.platform, b.deviceName), 'handoff');
        return { user, pair };
      });
      return sendTokens(reply, pair, user, b.client);
    },
  );
}

// ---------------------------------------------------------------- recovery codes

const formatRecovery = () => {
  const raw = randomToken(8).replace(/[^A-Za-z0-9]/g, '').toLowerCase().padEnd(8, '0').slice(0, 8);
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
};

async function replaceRecoveryCodes(client: import('pg').PoolClient, userId: string) {
  await client.query('DELETE FROM core.two_fa_recovery_codes WHERE user_id = $1', [userId]);
  const codes = Array.from({ length: 8 }, formatRecovery);
  for (const code of codes) {
    await client.query('INSERT INTO core.two_fa_recovery_codes (user_id, code_hash) VALUES ($1, $2)', [userId, sha256(code)]);
  }
  return codes;
}

async function useRecoveryCode(client: import('pg').PoolClient, userId: string, code: string) {
  const normalised = code.trim().toLowerCase();
  const { rows } = await client.query<{ id: string; code_hash: string }>(
    'SELECT id, code_hash FROM core.two_fa_recovery_codes WHERE user_id = $1 AND used_at IS NULL',
    [userId],
  );
  const hash = sha256(normalised);
  const match = rows.find((r) => safeEqual(r.code_hash, hash));
  if (!match) return false;
  await client.query('UPDATE core.two_fa_recovery_codes SET used_at = now() WHERE id = $1', [match.id]);
  return true;
}
