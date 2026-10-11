const { Client } = require('pg');
const { createRemoteJWKSet, jwtVerify } = require('jose');
const db = require('../db/database');

/**
 * ALTERA does not issue or check passwords. People sign in once with ALT Core and every app
 * accepts the same RS256 access token. We verify it with Core's public keys (JWKS), so no
 * secret is shared between services.
 */

const CORE_URL = (process.env.CORE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
const ISSUER = `${(process.env.ALT_PUBLIC_URL || 'http://localhost:8080').replace(/\/$/, '')}/core`;

let jwks = createRemoteJWKSet(new URL(`${CORE_URL}/.well-known/jwks.json`), { cooldownDuration: 30_000 });

/** Test seam: verify against a local key set instead of fetching Core's. */
function setKeySet(keySet) {
  jwks = keySet;
}

class AuthError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** Returns the token's claims, or throws AuthError. */
async function verifyToken(token) {
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer: ISSUER, audience: 'alt', algorithms: ['RS256'] });
    return { userId: payload.sub, sessionId: payload.sid, platform: payload.plat, roles: payload.roles || [] };
  } catch (err) {
    if (err && err.code === 'ERR_JWT_EXPIRED') throw new AuthError('TOKEN_EXPIRED', 'Token expired');
    throw new AuthError('INVALID_TOKEN', 'Invalid token');
  }
}

// "Sign out" and "sign out everywhere" must reach ALTERA immediately, not when the 15-minute
// access token expires. ALTERA may read core.sessions (one database); answers are cached briefly.
const SESSION_CACHE_MS = 15_000;
const sessionCache = new Map();
async function isSessionActive(sessionId, userId) {
  const hit = sessionCache.get(sessionId);
  if (hit && hit.until > Date.now()) return hit.active;
  const row = await db.queryOne(
    'SELECT 1 AS ok FROM core.sessions WHERE id = $1 AND revoked_at IS NULL AND expires_at > now()',
    [sessionId]
  );
  const active = Boolean(row);
  sessionCache.set(sessionId, { active, userId, until: Date.now() + (active ? SESSION_CACHE_MS : 60 * 60_000) });
  if (sessionCache.size > 10_000) sessionCache.clear();
  return active;
}

/** Verifies the token and that its session is still signed in. */
async function authenticate(token) {
  const claims = await verifyToken(token);
  if (!claims.sessionId || !(await isSessionActive(claims.sessionId, claims.userId))) {
    throw new AuthError('SESSION_REVOKED', 'You were signed out. Sign in again.');
  }
  return claims;
}

// People get an ALTERA profile row the first time they use ALTERA (account created in any ALT app).
const knownProfiles = new Set();
async function ensureProfile(userId) {
  if (knownProfiles.has(userId)) return;
  await db.query('INSERT INTO user_profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING', [userId]);
  knownProfiles.add(userId);
}

async function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Authentication required', code: 'UNAUTHORIZED' });
  }
  try {
    const claims = await authenticate(auth.slice(7));
    req.userId = claims.userId;
    req.auth = claims;
    req.accessToken = auth.slice(7);
    await ensureProfile(claims.userId);
    return next();
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(401).json({ message: err.message, code: err.code });
    }
    return next(err);
  }
}

/** Like authMiddleware, but lets anonymous requests through (req.userId stays undefined). */
async function optionalAuth(req, res, next) {
  if (!req.headers.authorization) return next();
  return authMiddleware(req, res, next);
}

// ALT Core announces ended sessions with Postgres NOTIFY the moment they commit, so ALTERA reacts
// instantly instead of waiting for the cache above to expire.
const REVOCATION_CHANNEL = 'alt_sessions_revoked';
const revocationHandlers = [];
let listener = null;

/** Registers a callback for ended sessions ({ sessionId } or { userId } for "everywhere"). */
function onSessionRevoked(handler) {
  revocationHandlers.push(handler);
}

function handleRevocation({ sessionId, userId }) {
  if (sessionId) {
    sessionCache.set(sessionId, { active: false, userId, until: Date.now() + 60 * 60_000 });
  } else if (userId) {
    // Some of this person's sessions ended (maybe all but the current one): re-check them all.
    for (const [sid, entry] of sessionCache) if (entry.userId === userId) sessionCache.delete(sid);
  }
  for (const handler of revocationHandlers) {
    Promise.resolve(handler({ sessionId, userId })).catch((err) => console.error('[auth] revocation handler', err.message));
  }
}

async function startRevocationListener() {
  if (listener) return;
  const needsSsl = /sslmode=require|neon\.tech/.test(process.env.DATABASE_URL || '');
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: needsSsl ? { rejectUnauthorized: false } : undefined });
  listener = client;
  client.on('notification', (msg) => {
    try {
      handleRevocation(JSON.parse(msg.payload));
    } catch {
      // ignore malformed payloads
    }
  });
  client.on('error', (err) => {
    console.error('[auth] revocation listener lost:', err.message);
    listener = null;
    setTimeout(() => startRevocationListener().catch(() => {}), 5000);
  });
  await client.connect();
  await client.query(`LISTEN ${REVOCATION_CHANNEL}`);
}

async function stopRevocationListener() {
  const client = listener;
  listener = null;
  if (client) await client.end().catch(() => {});
}

/** Test seam: forget cached session answers. */
function clearSessionCache() {
  sessionCache.clear();
}

module.exports = {
  verifyToken,
  authenticate,
  isSessionActive,
  authMiddleware,
  optionalAuth,
  ensureProfile,
  setKeySet,
  clearSessionCache,
  onSessionRevoked,
  startRevocationListener,
  stopRevocationListener,
  AuthError,
};
