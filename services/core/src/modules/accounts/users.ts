import type pg from 'pg';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { Ctx, Platform, Role } from '../../context.js';
import { encrypt, randomToken } from '../../lib/crypto.js';
import { conflict } from '../../lib/errors.js';
import { defaultAvatar } from '../../lib/avatars.js';

export interface UserRow {
  id: string;
  handle: string;
  email: string | null;
  email_verified_at: Date | null;
  display_name: string;
  bio: string | null;
  avatar_url: string | null;
  password_hash: string | null;
  roles: Role[];
  failed_login_count: number;
  locked_until: Date | null;
  two_fa_enabled: boolean;
  /** Set when ALT staff locked the account (with locked_until); NULL for the failed-password lock. */
  lock_reason: string | null;
  two_fa_secret_enc: string | null;
  two_fa_pending_secret_enc: string | null;
  two_fa_last_step: string | null;
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export const HANDLE_RE = /^[A-Za-z0-9_.]{3,30}$/;

/** Postgres returns enum arrays as '{a,b}' strings; normalise to string[]. */
export function parseRoles(value: unknown): Role[] {
  if (Array.isArray(value)) return value as Role[];
  if (typeof value === 'string') return value.replace(/^\{|\}$/g, '').split(',').filter(Boolean) as Role[];
  return [];
}

function normalise(row: UserRow | undefined) {
  if (row) row.roles = parseRoles(row.roles);
  return row;
}

export async function findUserById(q: pg.Pool | pg.PoolClient, id: string, forUpdate = false) {
  const { rows } = await q.query<UserRow>(
    `SELECT * FROM core.users WHERE id = $1 AND deleted_at IS NULL${forUpdate ? ' FOR UPDATE' : ''}`,
    [id],
  );
  return normalise(rows[0]);
}

export async function findUserByEmail(q: pg.Pool | pg.PoolClient, email: string) {
  const { rows } = await q.query<UserRow>('SELECT * FROM core.users WHERE email = $1 AND deleted_at IS NULL', [email]);
  return normalise(rows[0]);
}

export async function findUserByLogin(q: pg.Pool | pg.PoolClient, identifier: string) {
  const { rows } = await q.query<UserRow>(
    'SELECT * FROM core.users WHERE (email = $1 OR handle = $1) AND deleted_at IS NULL',
    [identifier],
  );
  return normalise(rows[0]);
}

export async function findUserByHandle(q: pg.Pool | pg.PoolClient, handle: string) {
  const { rows } = await q.query<UserRow>('SELECT * FROM core.users WHERE handle = $1 AND deleted_at IS NULL', [handle]);
  return normalise(rows[0]);
}

export async function handleTaken(q: pg.Pool | pg.PoolClient, handle: string) {
  const { rowCount } = await q.query('SELECT 1 FROM core.users WHERE handle = $1', [handle]);
  return (rowCount ?? 0) > 0;
}

/** Turns any string into a free handle: "Wamiq Ejaz" -> "wamiq_ejaz", then "wamiq_ejaz_4821" if taken. */
export async function uniqueHandle(q: pg.Pool | pg.PoolClient, base: string) {
  let stem = base
    .toLowerCase()
    .replace(/[^a-z0-9_.]+/g, '_')
    .replace(/^[_.]+|[_.]+$/g, '')
    .slice(0, 24);
  if (stem.length < 3) stem = `user_${stem}`.slice(0, 24);
  if (!(await handleTaken(q, stem))) return stem;
  for (let i = 0; i < 20; i++) {
    const candidate = `${stem}_${Math.floor(1000 + Math.random() * 9000)}`;
    if (!(await handleTaken(q, candidate))) return candidate;
  }
  return `${stem.slice(0, 18)}_${randomToken(4).toLowerCase().replace(/[^a-z0-9]/g, 'x')}`;
}

export interface NewUser {
  handle: string;
  displayName: string;
  email?: string | null;
  emailVerified?: boolean;
  passwordHash?: string | null;
  roles?: Role[];
}

/**
 * Creates the account and its custodial wallet in the caller's transaction.
 * Every ALT account owns a blockchain address from the first moment, so it can hold an AIT.
 */
export async function createUser(ctx: Ctx, client: pg.PoolClient, input: NewUser) {
  if (await handleTaken(client, input.handle)) throw conflict('HANDLE_TAKEN', 'That handle is already taken.');
  if (input.email && (await findUserByEmail(client, input.email))) {
    throw conflict('EMAIL_TAKEN', 'An account with this email already exists.');
  }
  const roles = new Set<Role>(input.roles?.length ? input.roles : ['participant']);
  if (input.email && ctx.config.adminEmails.includes(input.email.toLowerCase())) roles.add('admin');

  const { rows } = await client.query<UserRow>(
    `INSERT INTO core.users (handle, display_name, email, email_verified_at, password_hash, roles)
     VALUES ($1, $2, $3, $4, $5, $6::core.user_role[]) RETURNING *`,
    [input.handle, input.displayName, input.email ?? null, input.emailVerified ? new Date() : null, input.passwordHash ?? null, [...roles]],
  );
  const user = normalise(rows[0])!;
  // A ready-made picture until the person picks or uploads one (Google sign-in replaces it with theirs).
  user.avatar_url = defaultAvatar(ctx, 'human', user.id);
  await client.query('UPDATE core.users SET avatar_url = $2 WHERE id = $1', [user.id, user.avatar_url]);

  const privateKey = generatePrivateKey();
  const address = privateKeyToAccount(privateKey).address.toLowerCase();
  await client.query(
    `INSERT INTO core.wallets (user_id, address, kind, private_key_enc, is_primary, label)
     VALUES ($1, $2, 'custodial', $3, true, 'ALT wallet')`,
    [user.id, address, encrypt(ctx.config.encryptionKey, privateKey)],
  );
  // Starter test POL on ALT's own test chain (beta and development only), sent by the job worker.
  if (ctx.config.starterTestPol > 0 && ctx.chain?.isLocalDevChain) {
    const { rows: job } = await client.query<{ id: string }>(`INSERT INTO core.jobs (kind, payload) VALUES ('starter_funds', $1) RETURNING id`, [
      { userId: user.id, address },
    ]);
    await client.query(`SELECT pg_notify('alt_jobs', $1)`, [job[0]!.id]);
  }
  return user;
}

export async function touchPlatform(q: pg.Pool | pg.PoolClient, userId: string, platform: Platform) {
  await q.query(
    `INSERT INTO core.platform_memberships (user_id, platform) VALUES ($1, $2)
     ON CONFLICT (user_id, platform) DO UPDATE SET last_seen_at = now()`,
    [userId, platform],
  );
}

/** The signed-in user's own view of their account. */
export async function loadMe(q: pg.Pool | pg.PoolClient, user: UserRow) {
  const [wallets, platforms, platformAvatars] = await Promise.all([
    q.query(
      'SELECT address, kind, is_primary, label, created_at FROM core.wallets WHERE user_id = $1 ORDER BY is_primary DESC, created_at',
      [user.id],
    ),
    q.query('SELECT platform, joined_at, last_seen_at FROM core.platform_memberships WHERE user_id = $1 ORDER BY joined_at', [user.id]),
    q.query('SELECT platform, avatar_url FROM core.platform_avatars WHERE user_id = $1', [user.id]),
  ]);
  return {
    id: user.id,
    handle: user.handle,
    email: user.email,
    emailVerified: Boolean(user.email_verified_at),
    displayName: user.display_name,
    bio: user.bio,
    avatarUrl: user.avatar_url,
    /** Pictures chosen for one platform only; each platform falls back to `avatarUrl`. */
    platformAvatars: Object.fromEntries(platformAvatars.rows.map((p) => [p.platform as Platform, p.avatar_url as string])),
    roles: user.roles,
    twoFactorEnabled: user.two_fa_enabled,
    hasPassword: Boolean(user.password_hash),
    createdAt: user.created_at.toISOString(),
    wallets: wallets.rows.map((w) => ({
      address: w.address as string,
      kind: w.kind as 'custodial' | 'external',
      isPrimary: w.is_primary as boolean,
      label: (w.label as string | null) ?? null,
    })),
    platforms: platforms.rows.map((p) => ({
      platform: p.platform as Platform,
      joinedAt: (p.joined_at as Date).toISOString(),
      lastSeenAt: (p.last_seen_at as Date).toISOString(),
    })),
  };
}

export type Me = Awaited<ReturnType<typeof loadMe>>;

/** What anyone may see about a user. */
export async function publicProfile(q: pg.Pool | pg.PoolClient, user: UserRow) {
  const { rows } = await q.query('SELECT address FROM core.wallets WHERE user_id = $1 AND is_primary', [user.id]);
  return {
    id: user.id,
    handle: user.handle,
    displayName: user.display_name,
    bio: user.bio,
    avatarUrl: user.avatar_url,
    roles: user.roles.filter((r) => r !== 'admin'),
    walletAddress: (rows[0]?.address as string | undefined) ?? null,
    joinedAt: user.created_at.toISOString(),
  };
}
