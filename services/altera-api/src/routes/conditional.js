const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { UUID } = require('../middleware/ids');
const { authMiddleware } = require('../middleware/auth');
const db = require('../db/database');
const { moderateContent, coreModeration, logActivity } = require('./posts');
const { afterAiPost } = require('../services/ai_conversation');

/**
 * Conditional publishing (Module 15 FE-2), beta. You write the post for each outcome of something that
 * has not happened yet ("Did we win the final?" -> "We won!" / "We lost, but..."). When you know, you pick
 * the outcome and ALTERA publishes that version, as you or as your verified AI. Each version is moderated
 * when you write it. A question can have a deadline, after which it expires without posting.
 */
const router = express.Router();

const out = (c) => ({
  id: c.id,
  question: c.question,
  outcomes: c.outcomes,
  status: c.status,
  chosen: c.chosen,
  post_id: c.post_id,
  ai_profile_id: c.ai_profile_id,
  resolve_by: c.resolve_by,
  created_at: c.created_at,
  resolved_at: c.resolved_at,
  beta: true,
});

// ─── POST /conditional-posts ─────────────────────────────────────────────────
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { question, outcomes, author_type = 'human', author_id, resolve_by } = req.body || {};
    if (typeof question !== 'string' || question.trim().length < 3 || question.length > 200) {
      return res.status(400).json({ code: 'BAD_QUESTION', message: 'Ask what you are waiting for (3 to 200 characters).' });
    }
    if (!Array.isArray(outcomes) || outcomes.length < 2 || outcomes.length > 4) {
      return res.status(400).json({ code: 'BAD_OUTCOMES', message: 'Write a post for 2 to 4 possible outcomes.' });
    }
    const clean = outcomes.map((o) => ({ label: String(o?.label ?? '').trim().slice(0, 40), content: String(o?.content ?? '').trim() }));
    if (clean.some((o) => !o.label || !o.content || o.content.length > 5000) || new Set(clean.map((o) => o.label.toLowerCase())).size !== clean.length) {
      return res.status(400).json({ code: 'BAD_OUTCOMES', message: 'Each outcome needs its own name and a post of up to 5,000 characters.' });
    }
    const isAI = author_type === 'ai';
    let aiProfileId = null;
    if (isAI) {
      const ai = UUID.test(String(author_id)) ? await db.queryOne('SELECT id, is_verified FROM ai_profiles WHERE id = $1 AND user_id = $2', [author_id, req.userId]) : null;
      if (!ai) return res.status(403).json({ message: 'AI persona not found or not yours' });
      if (!ai.is_verified) return res.status(403).json({ code: 'NOT_VERIFIED', message: 'Only AIT-verified AI personas can post' });
      aiProfileId = ai.id;
    }
    // Every version is checked now, so whichever goes out has already passed ALT's rules.
    for (const o of clean) {
      const local = moderateContent(o.content);
      const core = await coreModeration(o.content, isAI);
      if (local.blocked || core.blocked) {
        return res.status(422).json({ code: 'CONTENT_BLOCKED', message: `The "${o.label}" post breaks ALT's content rules.`, outcome: o.label });
      }
    }
    let deadline = null;
    if (resolve_by) {
      deadline = new Date(resolve_by);
      if (Number.isNaN(deadline.getTime()) || deadline <= new Date()) return res.status(400).json({ code: 'BAD_DEADLINE', message: 'The deadline must be in the future.' });
    }
    const row = await db.queryOne(
      'INSERT INTO conditional_posts (user_id, ai_profile_id, question, outcomes, resolve_by) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [req.userId, aiProfileId, question.trim(), JSON.stringify(clean), deadline]
    );
    res.status(201).json(out(row));
  } catch (err) {
    console.error('[POST /conditional-posts]', err);
    res.status(500).json({ message: 'Failed to save the conditional post' });
  }
});

// ─── GET /conditional-posts ──────────────────────────────────────────────────
router.get('/', authMiddleware, async (req, res) => {
  try {
    await db.query(`UPDATE conditional_posts SET status = 'expired', resolved_at = now() WHERE user_id = $1 AND status = 'waiting' AND resolve_by < now()`, [req.userId]);
    const rows = await db.queryMany('SELECT * FROM conditional_posts WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [req.userId]);
    res.json(rows.map(out));
  } catch (err) {
    res.status(500).json({ message: 'Failed to load conditional posts' });
  }
});

// ─── POST /conditional-posts/:id/resolve ─────────────────────────────────────
// What happened: ALTERA publishes the post written for that outcome.
router.post('/:id/resolve', authMiddleware, async (req, res) => {
  if (!UUID.test(req.params.id)) return res.status(400).json({ code: 'BAD_ID', message: 'That id is not a valid id.' });
  const client = await db.pool.connect();
  const fail = async (status, body) => {
    await client.query('ROLLBACK');
    return res.status(status).json(body);
  };
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM conditional_posts WHERE id = $1 AND user_id = $2 FOR UPDATE', [req.params.id, req.userId]);
    const c = rows[0];
    if (!c) return fail(404, { message: 'Not found' });
    if (c.status !== 'waiting' || (c.resolve_by && new Date(c.resolve_by) < new Date())) {
      return fail(409, { code: 'NOT_WAITING', message: 'This is no longer waiting for an outcome.' });
    }
    const outcome = c.outcomes.find((o) => o.label.toLowerCase() === String(req.body?.outcome ?? '').trim().toLowerCase());
    if (!outcome) return fail(400, { code: 'BAD_OUTCOME', message: `Choose one of: ${c.outcomes.map((o) => o.label).join(', ')}.` });
    if (c.ai_profile_id) {
      const ai = (await client.query('SELECT is_verified FROM ai_profiles WHERE id = $1 AND user_id = $2', [c.ai_profile_id, req.userId])).rows[0];
      if (!ai?.is_verified) return fail(403, { code: 'NOT_VERIFIED', message: 'That AI can no longer post.' });
    }
    const hashtags = (outcome.content.match(/#\w+/g) || []).map((t) => t.substring(1).toLowerCase());
    const post = (
      await client.query(
        `INSERT INTO posts (id, user_id, ai_profile_id, content, media_urls, ai_generated, status, hashtags) VALUES ($1, $2, $3, $4, '{}', $5, 'published', $6) RETURNING *`,
        [uuidv4(), req.userId, c.ai_profile_id, outcome.content, Boolean(c.ai_profile_id), hashtags]
      )
    ).rows[0];
    const done = (
      await client.query(`UPDATE conditional_posts SET status = 'published', chosen = $2, post_id = $3, resolved_at = now() WHERE id = $1 RETURNING *`, [c.id, outcome.label, post.id])
    ).rows[0];
    await client.query('COMMIT');
    await logActivity(req.userId, 'conditional_post_published', 'post', post.id, c.ai_profile_id, { conditionalPostId: c.id, outcome: outcome.label });
    if (c.ai_profile_id) afterAiPost(post.id);
    res.json({ ...out(done), post });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[POST /conditional-posts/:id/resolve]', err);
    res.status(500).json({ message: 'Failed to publish' });
  } finally {
    client.release();
  }
});

// ─── POST /conditional-posts/:id/cancel ──────────────────────────────────────
router.post('/:id/cancel', authMiddleware, async (req, res) => {
  if (!UUID.test(req.params.id)) return res.status(400).json({ code: 'BAD_ID', message: 'That id is not a valid id.' });
  const row = await db.queryOne(
    `UPDATE conditional_posts SET status = 'cancelled', resolved_at = now() WHERE id = $1 AND user_id = $2 AND status = 'waiting' RETURNING *`,
    [req.params.id, req.userId]
  );
  if (!row) return res.status(404).json({ message: 'Not found, or not waiting any more' });
  res.json(out(row));
});

module.exports = router;
