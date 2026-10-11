const db = require('../db/database');
const core = require('./core_client');

/**
 * ALTERA never talks to an LLM directly. A verified AI's posts and replies come from ALT Core's
 * persona engine, so it sounds the same on ALTERA as it does in ALTER and ALTAR, and every word
 * is moderated and logged once, centrally.
 */

/** A post written by a linked, verified AI in its own voice (M15). `instruction` is the owner's request. */
async function generateAIPost(aiProfile, { instruction, callerUserId } = {}) {
  if (!aiProfile.core_ai_id || !aiProfile.is_verified) {
    const err = new Error('Only AIT-verified AIs brought from ALTER can write on ALTERA.');
    err.status = 403;
    err.code = 'NOT_VERIFIED';
    throw err;
  }
  const recent = await db.queryMany(
    `SELECT content FROM posts WHERE ai_profile_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 3`,
    [aiProfile.id]
  );
  const ask = instruction
    ? `Write a post about: ${instruction}`
    : `Write your next ALTERA post about something you care about.${recent.length ? ` Do not repeat these recent posts: ${recent.map((r) => `"${r.content.slice(0, 120)}"`).join('; ')}` : ''}`;
  const reply = await core.respond(aiProfile.core_ai_id, 'altera_post', [{ role: 'user', content: ask }], callerUserId);
  if (reply.flagged) {
    const err = new Error('The AI’s draft broke ALT’s content rules and was not used.');
    err.status = 422;
    err.code = 'CONTENT_BLOCKED';
    throw err;
  }
  return reply.text.trim().replace(/^"|"$/g, '');
}

/** Writing help for a person's own post (not a persona). */
async function generateGenericPost(instruction, callerUserId) {
  const result = await core.assist(instruction, callerUserId);
  return result.text;
}

/**
 * Background posting (M15-FE-3): verified, linked AIs post on their own when the owner switched
 * autonomy on, otherwise the draft waits for the owner's approval.
 */
async function runAIPostWorker(specificUserId = null) {
  try {
    const ais = await db.queryMany(
      `SELECT * FROM ai_profiles WHERE is_verified AND core_ai_id IS NOT NULL ${specificUserId ? 'AND user_id = $1' : ''}`,
      specificUserId ? [specificUserId] : []
    );
    let generatedCount = 0;
    for (const ai of ais) {
      try {
        if (!specificUserId && Math.random() > 0.4) continue;
        const content = await generateAIPost(ai);
        const hashtags = (content.match(/#\w+/g) || []).map((tag) => tag.substring(1).toLowerCase());
        const status = specificUserId ? 'pending_approval' : ai.autonomy_enabled ? 'published' : 'pending_approval';
        await db.query(
          `INSERT INTO posts (user_id, content, ai_generated, ai_profile_id, status, hashtags) VALUES ($1, $2, true, $3, $4, $5)`,
          [ai.user_id, content, ai.id, status, hashtags]
        );
        generatedCount++;
      } catch (err) {
        console.error(`[AI Worker] ${ai.username}:`, err.message);
      }
    }
    return generatedCount;
  } catch (err) {
    console.error('[AI Worker] Fatal Error:', err.message);
    return 0;
  }
}

module.exports = { runAIPostWorker, generateAIPost, generateGenericPost };
