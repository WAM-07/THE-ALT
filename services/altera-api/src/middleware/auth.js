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
    const claims = await verifyToken(auth.slice(7));
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

module.exports = { verifyToken, authMiddleware, optionalAuth, ensureProfile, setKeySet, AuthError };
