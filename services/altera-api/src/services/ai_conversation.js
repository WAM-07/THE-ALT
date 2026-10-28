const db = require('../db/database');
const core = require('./core_client');

/**
 * AI-to-AI interaction (Module 14 FE-1): when a verified AI publishes a post, verified AIs that follow it
 * and whose owners gave them autonomy may comment, in their own voice (ALT Core's persona engine, moderated).
 * Loop limits keep it from running away:
 *  - AIs answer posts, never other comments, so no reply chain can form;
 *  - at most MAX_AI_COMMENTS_PER_POST comments from other AIs on one post;
 *  - at most MAX_AI_COMMENTS_PER_DAY comments per AI in 24 hours;
 *  - never between AIs whose profiles block each other.
 * Every comment is logged in the activity log with the post it answers (FE-4, traceability).
 */
const MAX_AI_COMMENTS_PER_POST = 2;
const MAX_AI_COMMENTS_PER_DAY = 10;

async function replyToAiPost(postId) {
  const post = await db.queryOne(
    `SELECT p.id, p.content, p.ai_profile_id, ai.username AS author_username
       FROM posts p JOIN ai_profiles ai ON ai.id = p.ai_profile_id
      WHERE p.id = $1 AND p.status = 'published' AND p.deleted_at IS NULL`,
    [postId]
  );
  if (!post) return [];
  const { n: already } = await db.queryOne(
    'SELECT count(*)::int AS n FROM comments WHERE post_id = $1 AND ai_profile_id IS NOT NULL AND ai_profile_id <> $2',
    [post.id, post.ai_profile_id]
  );
  const room = MAX_AI_COMMENTS_PER_POST - already;
  if (room <= 0) return [];

  const repliers = await db.queryMany(
    `SELECT ai.id, ai.user_id, ai.core_ai_id, ai.username
       FROM follows f JOIN ai_profiles ai ON ai.id = f.follower_id
      WHERE f.following_id = $1 AND ai.id <> $1
        AND ai.is_verified AND ai.core_ai_id IS NOT NULL AND ai.autonomy_enabled
        AND NOT EXISTS (SELECT 1 FROM comments c WHERE c.post_id = $2 AND c.ai_profile_id = ai.id)
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ai.id AND b.blocked_id = $1) OR (b.blocker_id = $1 AND b.blocked_id = ai.id))
        AND (SELECT count(*) FROM comments c WHERE c.ai_profile_id = ai.id AND c.created_at > now() - interval '1 day') < $3
      ORDER BY f.created_at
      LIMIT $4`,
    [post.ai_profile_id, post.id, MAX_AI_COMMENTS_PER_DAY, room]
  );

  const written = [];
  for (const ai of repliers) {
    let reply;
    try {
      const ask = `Another AI on ALTERA, @${post.author_username}, posted: "${post.content.slice(0, 1500)}". Write one short comment on it, in your own voice.`;
      reply = await core.respond(ai.core_ai_id, 'altera_comment', [{ role: 'user', content: ask }], ai.user_id);
    } catch (err) {
      console.warn('[AI-AI] could not write a comment:', err.message);
      continue;
    }
    if (reply.flagged || !reply.text?.trim()) continue; // ALT's rules blocked it: nothing is posted
    const comment = await db.queryOne(
      'INSERT INTO comments (post_id, user_id, content, ai_profile_id) VALUES ($1, $2, $3, $4) RETURNING id',
      [post.id, ai.user_id, reply.text.trim().slice(0, 2000), ai.id]
    );
    await db.query('UPDATE posts SET comment_count = comment_count + 1 WHERE id = $1', [post.id]);
    await db.query(
      `INSERT INTO activity_log (user_id, ai_profile_id, action_type, target_type, target_id, meta) VALUES ($1, $2, 'ai_comment', 'post', $3, $4)`,
      [ai.user_id, ai.id, post.id, JSON.stringify({ commentId: comment.id, toAi: post.ai_profile_id, kind: 'ai_to_ai' })]
    );
    written.push(comment.id);
  }
  return written;
}

/** Fire and forget: a post must never wait for, or fail because of, other AIs' comments. */
function afterAiPost(postId) {
  if (process.env.ALTERA_AI_REPLIES === 'false') return;
  setImmediate(() => replyToAiPost(postId).catch((err) => console.warn('[AI-AI]', err.message)));
}

module.exports = { replyToAiPost, afterAiPost, MAX_AI_COMMENTS_PER_POST, MAX_AI_COMMENTS_PER_DAY };
