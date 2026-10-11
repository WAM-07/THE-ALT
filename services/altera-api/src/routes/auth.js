const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const db = require('../db/database');
const { storeImageDataUri } = require('../services/media_storage');

/**
 * ALTERA's session profile. Signing up, signing in, passwords, OTP codes and Google sign-in are
 * handled once for the whole ecosystem by ALT Core (/core/auth/*). This router only returns the
 * ALTERA view of the signed-in person (their human profile plus their AI personas) and updates it.
 */
const router = express.Router();

const CORE_URL = (process.env.CORE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
const PUBLIC_URL = (process.env.ALT_PUBLIC_URL || 'http://localhost:8080').replace(/\/$/, '');

async function getHumanFollowCounts(userId) {
  const counts = await db.queryOne(
    `SELECT
       (SELECT COUNT(*) FROM follows WHERE following_id = $1) as follower_count,
       (SELECT COUNT(*) FROM follows WHERE follower_id = $1) as following_count,
       (SELECT COUNT(*) FROM posts WHERE user_id = $1 AND deleted_at IS NULL AND status = 'published') as post_count`,
    [userId]
  );

  return {
    follower_count: parseInt(counts?.follower_count || 0, 10),
    following_count: parseInt(counts?.following_count || 0, 10),
    post_count: parseInt(counts?.post_count || 0, 10),
  };
}

async function getAIFollowCounts(aiProfileId) {
  const counts = await db.queryOne(
    `SELECT
       (SELECT COUNT(*) FROM follows WHERE following_id = $1) as follower_count,
       (SELECT COUNT(*) FROM posts WHERE ai_profile_id = $1 AND deleted_at IS NULL AND status = 'published') as post_count`,
    [aiProfileId]
  );

  return {
    follower_count: parseInt(counts?.follower_count || 0, 10),
    post_count: parseInt(counts?.post_count || 0, 10),
  };
}

function deriveAIMetadata(profile) {
  const category =
    typeof profile?.category === 'string' && profile.category.trim().length > 0
      ? profile.category.trim().toLowerCase()
      : 'general';

  let modelIdentity = 'ALTERA Social Core';
  let traits = ['Adaptive', 'Social'];
  if (category === 'companion') {
    modelIdentity = 'ALTERA Companion Core';
    traits = ['Empathetic', 'Conversational'];
  } else if (category === 'creative') {
    modelIdentity = 'ALTERA Creative Core';
    traits = ['Creative', 'Expressive'];
  } else if (category === 'technical') {
    modelIdentity = 'ALTERA Technical Core';
    traits = ['Analytical', 'Strategic'];
  }

  if (profile?.health_score >= 95) traits.push('High-Trust');
  if (profile?.autonomy_enabled) {
    traits.push('Autonomous');
  } else {
    traits.push('Human-Guided');
  }
  if (profile?.is_verified) traits.push('AIT-Verified');

  return {
    category,
    model_identity: modelIdentity,
    personality_traits: traits,
  };
}

/** Name and avatar are part of the ALT account, so they are changed in Core on the person's behalf. */
async function updateCoreProfile(accessToken, fields) {
  const res = await fetch(`${CORE_URL}/me`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(fields),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body?.error?.message || 'Could not update your ALT account');
    err.status = res.status;
    throw err;
  }
}

// ─── PUT /auth/profile ───────────────────────────────────────────────────────
router.put('/profile', authMiddleware, async (req, res) => {
  try {
    const { profile_id, avatar, bio, display_name, cover } = req.body;
    if (!profile_id) return res.status(400).json({ message: 'profile_id is required' });

    let avatarUrl = avatar;
    // Persist avatar uploads so they survive redeploys.
    if (avatar && avatar.startsWith('data:image')) {
      avatarUrl = await storeImageDataUri({ userId: req.userId, dataUri: avatar, purpose: 'avatar' }) || avatar;
    }

    if (profile_id === req.userId) {
      // The person: name and avatar are global (ALT Core); bio and cover are ALTERA-only.
      const coreFields = {};
      if (display_name !== undefined) coreFields.displayName = display_name;
      if (avatarUrl) coreFields.avatarUrl = avatarUrl.startsWith('/') ? `${PUBLIC_URL}/altera${avatarUrl}` : avatarUrl;
      if (Object.keys(coreFields).length) await updateCoreProfile(req.accessToken, coreFields);

      if (bio !== undefined || cover !== undefined) {
        await db.query(
          `UPDATE user_profiles SET bio = CASE WHEN $2 THEN $3 ELSE bio END,
                  cover_url = CASE WHEN $4 THEN $5 ELSE cover_url END WHERE user_id = $1`,
          [req.userId, bio !== undefined, bio ?? null, cover !== undefined, cover ?? null]
        );
      }
      return res.json({ message: 'Profile updated', avatar_url: coreFields.avatarUrl ?? avatarUrl });
    }

    // One of the person's AI personas.
    const aiProfile = await db.queryOne('SELECT id FROM ai_profiles WHERE id = $1 AND user_id = $2', [profile_id, req.userId]);
    if (!aiProfile) return res.status(403).json({ message: 'AI Persona not found or unauthorized' });

    const updates = [];
    const values = [];
    let i = 1;
    if (avatarUrl) {
      updates.push(`avatar = $${i++}`);
      values.push(avatarUrl);
    }
    if (bio !== undefined) {
      updates.push(`bio = $${i++}`);
      values.push(bio);
    }
    if (display_name !== undefined) {
      updates.push(`display_name = $${i++}`);
      values.push(display_name);
    }
    if (updates.length > 0) {
      values.push(profile_id);
      await db.query(`UPDATE ai_profiles SET ${updates.join(', ')} WHERE id = $${i}`, values);
    }
    return res.json({ message: 'AI Profile updated', avatar_url: avatarUrl });
  } catch (err) {
    console.error('Error in PUT /profile:', err.message);
    res.status(err.status && err.status < 500 ? err.status : 500).json({ message: err.status ? err.message : 'Failed to update profile' });
  }
});

// ─── GET /auth/me ─────────────────────────────────────────────────────────────
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await db.queryOne('SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL', [req.userId]);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const humanCounts = await getHumanFollowCounts(user.id);
    const aiProfilesRaw = await db.queryMany('SELECT * FROM ai_profiles WHERE user_id = $1 ORDER BY created_at', [user.id]);
    const aiProfiles = await Promise.all(aiProfilesRaw.map(async (p) => {
      const counts = await getAIFollowCounts(p.id);
      return {
        ...p,
        ...deriveAIMetadata(p),
        follower_count: counts.follower_count,
        post_count: counts.post_count,
      };
    }));

    res.json({
      id: user.id,
      email: user.email,
      username: user.username,
      wallet_address: user.wallet_address,
      created_at: user.created_at,
      human_profile: {
        id: user.id,
        user_id: user.id,
        username: user.username,
        display_name: user.full_name,
        avatar: user.avatar_url,
        bio: user.bio,
        cover: user.cover_url,
        is_verified: user.is_verified,
        follower_count: humanCounts.follower_count,
        following_count: humanCounts.following_count,
        post_count: humanCounts.post_count,
        health_score: parseFloat(user.health_score || 100),
      },
      ai_profiles: aiProfiles,
    });
  } catch (err) {
    console.error('Error in /me:', err.message);
    res.status(500).json({ message: 'Failed to fetch user' });
  }
});

// ─── Everything else moved to ALT Core ───────────────────────────────────────
const MOVED = {
  '/register': '/core/auth/register',
  '/login': '/core/auth/login',
  '/logout': '/core/auth/logout',
  '/refresh': '/core/auth/refresh',
  '/auth0': '/core/auth/google',
  '/request-otp': '/core/auth/otp/resend',
  '/verify-otp': '/core/auth/email/verify',
  '/forgot-password': '/core/auth/password/forgot',
  '/reset-password': '/core/auth/password/reset',
  '/change-password': '/core/auth/password/change',
  '/set-initial-password': '/core/auth/password/change',
};
for (const [path, replacement] of Object.entries(MOVED)) {
  router.all(path, (_req, res) =>
    res.status(410).json({
      message: 'Sign-in is handled by your ALT account now.',
      code: 'MOVED_TO_ALT_CORE',
      use: replacement,
    })
  );
}

module.exports = router;
module.exports.deriveAIMetadata = deriveAIMetadata;
