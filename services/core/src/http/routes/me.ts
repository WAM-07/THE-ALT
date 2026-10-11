import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import type { Ctx } from '../../context.js';
import { tx } from '../../db.js';
import { audit, publish } from '../../lib/audit.js';
import { randomToken } from '../../lib/crypto.js';
import { badRequest, conflict, notFound, unauthorized } from '../../lib/errors.js';
import { revokeAllSessions, revokeSession } from '../../modules/accounts/sessions.js';
import { consumeSiwe, createSiweNonce } from '../../modules/accounts/siwe.js';
import { findUserById, handleTaken, loadMe, touchPlatform } from '../../modules/accounts/users.js';
import { requireUser } from '../auth-guard.js';
import { Address, DisplayName, Handle, Platform, SelfRole } from '../schemas.js';

/** Only pictures served by ALT itself (or its Cloudinary account) may become an avatar: no tracking pixels. */
function isTrustedMediaUrl(ctx: Ctx, url: string) {
  return url.startsWith(`${ctx.config.publicUrl}/`) || url.startsWith('https://res.cloudinary.com/');
}

const AVATAR_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

export async function meRoutes(app: FastifyInstance, ctx: Ctx) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const authed = requireUser(ctx);

  const current = async (userId: string) => {
    const user = await findUserById(ctx.db, userId);
    if (!user) throw unauthorized();
    return user;
  };

  r.get('/me', { preHandler: authed, schema: { tags: ['account'], summary: 'The signed-in ALT account' } }, async (req) => {
    return loadMe(ctx.db, await current(req.auth!.userId));
  });

  r.patch(
    '/me',
    {
      preHandler: authed,
      schema: {
        tags: ['account'],
        summary: 'Update the profile shown across ALTER, ALTAR and ALTERA',
        body: z
          .object({
            displayName: DisplayName.optional(),
            handle: Handle.optional(),
            bio: z.string().max(500).nullable().optional(),
            /** An image already hosted by an ALT service (e.g. uploaded through ALTERA) or Cloudinary. */
            avatarUrl: z.url().max(500).nullable().optional(),
          })
          .refine((b) => Object.keys(b).length > 0, 'Nothing to update'),
      },
    },
    async (req) => {
      const b = req.body;
      if (b.avatarUrl && !isTrustedMediaUrl(ctx, b.avatarUrl)) {
        throw badRequest('AVATAR_URL_NOT_ALLOWED', 'Upload the picture through an ALT app instead.');
      }
      const user = await tx(ctx.db, async (client) => {
        const before = await findUserById(client, req.auth!.userId, true);
        if (!before) throw unauthorized();
        if (b.handle && b.handle.toLowerCase() !== before.handle.toLowerCase() && (await handleTaken(client, b.handle))) {
          throw conflict('HANDLE_TAKEN', 'That handle is already taken.');
        }
        await client.query(
          `UPDATE core.users SET display_name = COALESCE($2, display_name), handle = COALESCE($3, handle),
                  bio = CASE WHEN $5 THEN $4 ELSE bio END,
                  avatar_url = CASE WHEN $7 THEN $6 ELSE avatar_url END WHERE id = $1`,
          [before.id, b.displayName ?? null, b.handle ?? null, b.bio ?? null, b.bio !== undefined, b.avatarUrl ?? null, b.avatarUrl !== undefined],
        );
        await audit(client, {
          action: 'account.profile_updated',
          actorUserId: before.id,
          entityType: 'user',
          entityId: before.id,
          ip: req.ip,
          data: { fields: Object.keys(b), ...(b.handle ? { oldHandle: before.handle, newHandle: b.handle } : {}) },
        });
        await publish(client, 'user.updated', { userId: before.id, fields: Object.keys(b) });
        return findUserById(client, before.id);
      });
      return loadMe(ctx.db, user!);
    },
  );

  r.post(
    '/me/avatar',
    { preHandler: authed, schema: { tags: ['account'], summary: 'Upload a profile picture (PNG, JPEG or WebP, up to 5 MB)', consumes: ['multipart/form-data'] } },
    async (req) => {
      const file = await req.file({ limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
      if (!file) throw badRequest('FILE_REQUIRED', 'Attach an image file.');
      const ext = AVATAR_TYPES[file.mimetype];
      if (!ext) throw badRequest('UNSUPPORTED_TYPE', 'Use a PNG, JPEG or WebP image.');
      const name = `${req.auth!.userId}-${randomToken(6)}.${ext}`;
      const dir = path.resolve(ctx.config.storageDir, 'avatars');
      await mkdir(dir, { recursive: true });
      await pipeline(file.file, createWriteStream(path.join(dir, name)));
      if (file.file.truncated) throw badRequest('FILE_TOO_LARGE', 'The image must be 5 MB or smaller.');
      const url = `${ctx.config.publicUrl}/core/media/avatars/${name}`;
      await tx(ctx.db, async (client) => {
        await client.query('UPDATE core.users SET avatar_url = $2 WHERE id = $1', [req.auth!.userId, url]);
        await publish(client, 'user.updated', { userId: req.auth!.userId, fields: ['avatarUrl'] });
      });
      return { avatarUrl: url };
    },
  );

  r.delete(
    '/me',
    {
      preHandler: authed,
      schema: {
        tags: ['account'],
        summary: 'Delete the ALT account everywhere (personal data is removed)',
        body: z.object({ password: z.string().max(128).optional(), confirm: z.literal('DELETE') }),
      },
    },
    async (req) => {
      const user = await current(req.auth!.userId);
      if (user.password_hash && !(req.body.password && (await bcrypt.compare(req.body.password, user.password_hash)))) {
        throw unauthorized('INVALID_CREDENTIALS', 'Your password is wrong.');
      }
      await tx(ctx.db, async (client) => {
        await client.query(
          `UPDATE core.users SET email = NULL, handle = $2, display_name = 'Deleted user', bio = NULL, avatar_url = NULL,
                  password_hash = NULL, two_fa_enabled = false, two_fa_secret_enc = NULL, two_fa_pending_secret_enc = NULL,
                  deleted_at = now() WHERE id = $1`,
          [user.id, `deleted_${user.id.slice(0, 8)}`],
        );
        await client.query('DELETE FROM core.auth_identities WHERE user_id = $1', [user.id]);
        await client.query(`DELETE FROM core.wallets WHERE user_id = $1 AND kind = 'external'`, [user.id]);
        await client.query('DELETE FROM core.two_fa_recovery_codes WHERE user_id = $1', [user.id]);
        await revokeAllSessions(client, user.id, 'account_deleted');
        await audit(client, { action: 'account.deleted', actorUserId: user.id, entityType: 'user', entityId: user.id, ip: req.ip });
        await publish(client, 'user.deleted', { userId: user.id });
      });
      return { deleted: true };
    },
  );

  // ---------------------------------------------------------------- roles

  r.put(
    '/me/roles',
    {
      preHandler: authed,
      schema: {
        tags: ['account'],
        summary: 'Choose creator / consumer / participant roles (admin is assigned by admins)',
        body: z.object({ roles: z.array(SelfRole).min(1).max(3) }),
      },
    },
    async (req) => {
      const user = await current(req.auth!.userId);
      const next = [...new Set([...req.body.roles, ...(user.roles.includes('admin') ? (['admin'] as const) : [])])];
      await tx(ctx.db, async (client) => {
        await client.query('UPDATE core.users SET roles = $2::core.user_role[] WHERE id = $1', [user.id, next]);
        await audit(client, { action: 'account.roles_changed', actorUserId: user.id, entityType: 'user', entityId: user.id, ip: req.ip, data: { from: user.roles, to: next } });
      });
      // Roles are inside access tokens; clients should refresh to pick up the change.
      return { roles: next, refreshRequired: true };
    },
  );

  // ---------------------------------------------------------------- sessions (devices)

  r.get('/me/sessions', { preHandler: authed, schema: { tags: ['account'], summary: 'Devices and apps signed in to this account' } }, async (req) => {
    const { rows } = await ctx.db.query(
      `SELECT id, platform, device_name, user_agent, ip, created_at, last_used_at FROM core.sessions
        WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now() ORDER BY last_used_at DESC`,
      [req.auth!.userId],
    );
    return rows.map((s) => ({
      id: s.id as string,
      platform: s.platform as string,
      deviceName: s.device_name as string | null,
      userAgent: s.user_agent as string | null,
      ip: s.ip as string | null,
      createdAt: (s.created_at as Date).toISOString(),
      lastUsedAt: (s.last_used_at as Date).toISOString(),
      current: s.id === req.auth!.sessionId,
    }));
  });

  r.delete(
    '/me/sessions/:id',
    { preHandler: authed, schema: { tags: ['account'], summary: 'Sign out one device', params: z.object({ id: z.uuid() }) } },
    async (req) => {
      const ok = await tx(ctx.db, async (client) => {
        const done = await revokeSession(client, req.auth!.userId, req.params.id, 'revoked_by_user');
        if (done) await audit(client, { action: 'auth.session.revoked', actorUserId: req.auth!.userId, entityType: 'session', entityId: req.params.id, ip: req.ip });
        return done;
      });
      if (!ok) throw notFound('Session');
      return { ok: true };
    },
  );

  // ---------------------------------------------------------------- connected platforms

  r.get('/me/platforms', { preHandler: authed, schema: { tags: ['account'], summary: 'ALT apps this account has used' } }, async (req) => {
    return (await loadMe(ctx.db, await current(req.auth!.userId))).platforms;
  });

  r.put(
    '/me/platforms/:platform',
    { preHandler: authed, schema: { tags: ['account'], summary: 'Record that the user opened an ALT app', params: z.object({ platform: Platform }) } },
    async (req) => {
      await touchPlatform(ctx.db, req.auth!.userId, req.params.platform);
      return { ok: true };
    },
  );

  // ---------------------------------------------------------------- wallets

  r.post(
    '/me/wallets/nonce',
    { preHandler: authed, schema: { tags: ['wallets'], summary: 'Get a nonce to prove ownership of a wallet you want to link' } },
    async (req) => {
      const n = await createSiweNonce(ctx.db, 'link', req.auth!.userId);
      return { ...n, domain: ctx.config.publicHost, uri: ctx.config.publicUrl, statement: 'Link this wallet to my ALT account.' };
    },
  );

  r.post(
    '/me/wallets/link',
    {
      preHandler: authed,
      schema: {
        tags: ['wallets'],
        summary: 'Link a wallet you control (signed EIP-4361 message)',
        body: z.object({ message: z.string().min(1).max(4000), signature: z.string().regex(/^0x[0-9a-fA-F]+$/), makePrimary: z.boolean().default(false) }),
      },
    },
    async (req) => {
      const userId = req.auth!.userId;
      await tx(ctx.db, async (client) => {
        const address = await consumeSiwe(ctx, client, req.body.message, req.body.signature, 'link', userId);
        const { rows } = await client.query('SELECT user_id FROM core.wallets WHERE address = $1', [address]);
        if (rows[0]) {
          throw conflict('WALLET_IN_USE', rows[0].user_id === userId ? 'This wallet is already linked.' : 'This wallet is linked to another ALT account.');
        }
        if (req.body.makePrimary) await client.query('UPDATE core.wallets SET is_primary = false WHERE user_id = $1', [userId]);
        await client.query(
          `INSERT INTO core.wallets (user_id, address, kind, is_primary, label) VALUES ($1, $2, 'external', $3, 'Linked wallet')`,
          [userId, address, req.body.makePrimary],
        );
        await audit(client, { action: 'wallet.linked', actorUserId: userId, entityType: 'wallet', entityId: address, ip: req.ip, data: { primary: req.body.makePrimary } });
        await publish(client, 'user.wallets_changed', { userId });
      });
      return (await loadMe(ctx.db, await current(userId))).wallets;
    },
  );

  r.put(
    '/me/wallets/:address/primary',
    { preHandler: authed, schema: { tags: ['wallets'], summary: 'Use this wallet as the primary (receives AITs and payouts)', params: z.object({ address: Address }) } },
    async (req) => {
      const userId = req.auth!.userId;
      await tx(ctx.db, async (client) => {
        const { rowCount } = await client.query('SELECT 1 FROM core.wallets WHERE user_id = $1 AND address = $2', [userId, req.params.address]);
        if (!rowCount) throw notFound('Wallet');
        await client.query('UPDATE core.wallets SET is_primary = false WHERE user_id = $1', [userId]);
        await client.query('UPDATE core.wallets SET is_primary = true WHERE user_id = $1 AND address = $2', [userId, req.params.address]);
        await audit(client, { action: 'wallet.primary_changed', actorUserId: userId, entityType: 'wallet', entityId: req.params.address, ip: req.ip });
        await publish(client, 'user.wallets_changed', { userId });
      });
      return (await loadMe(ctx.db, await current(userId))).wallets;
    },
  );

  r.delete(
    '/me/wallets/:address',
    { preHandler: authed, schema: { tags: ['wallets'], summary: 'Unlink an external wallet', params: z.object({ address: Address }) } },
    async (req) => {
      const userId = req.auth!.userId;
      await tx(ctx.db, async (client) => {
        const { rows } = await client.query('SELECT kind, is_primary FROM core.wallets WHERE user_id = $1 AND address = $2', [userId, req.params.address]);
        const wallet = rows[0];
        if (!wallet) throw notFound('Wallet');
        if (wallet.kind === 'custodial') throw badRequest('WALLET_CUSTODIAL', 'Your ALT wallet cannot be removed.');
        const user = await findUserById(client, userId);
        const { rowCount: otherExternal } = await client.query(
          `SELECT 1 FROM core.wallets WHERE user_id = $1 AND kind = 'external' AND address <> $2`,
          [userId, req.params.address],
        );
        const { rowCount: identities } = await client.query('SELECT 1 FROM core.auth_identities WHERE user_id = $1', [userId]);
        if (!user?.password_hash && !otherExternal && !identities) {
          throw badRequest('LAST_SIGN_IN_METHOD', 'Set a password or link Google first, or you could not sign in again.');
        }
        await client.query('DELETE FROM core.wallets WHERE user_id = $1 AND address = $2', [userId, req.params.address]);
        if (wallet.is_primary) {
          await client.query(`UPDATE core.wallets SET is_primary = true WHERE user_id = $1 AND kind = 'custodial'`, [userId]);
        }
        await audit(client, { action: 'wallet.unlinked', actorUserId: userId, entityType: 'wallet', entityId: req.params.address, ip: req.ip });
        await publish(client, 'user.wallets_changed', { userId });
      });
      return (await loadMe(ctx.db, await current(userId))).wallets;
    },
  );
}
