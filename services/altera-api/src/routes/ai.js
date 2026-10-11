const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const db = require('../db/database');
const { runAIPostWorker, generateAIPost, generateGenericPost } = require('../services/ai_generator');

const router = express.Router();

const fail = (res, err, fallback) => {
  const status = err.status && err.status < 600 ? err.status : 500;
  res.status(status).json({ message: status >= 500 ? fallback : err.message, code: err.code });
};

// ─── POST /ai/generate-posts ─────────────────────────────────────────────────
// Asks each of the signed-in person's verified AIs for a post draft, waiting for their approval.
router.post('/generate-posts', authMiddleware, async (req, res) => {
  try {
    const generatedCount = await runAIPostWorker(req.userId);
    res.json({ message: `Generated ${generatedCount} draft post(s) for your approval.`, count: generatedCount });
  } catch (err) {
    fail(res, err, 'Failed to generate AI posts');
  }
});

// ─── POST /ai/generate ───────────────────────────────────────────────────────
// With profile_id of one of your verified AIs: the AI drafts the post in its own voice (M15-FE-1/5).
// Without it: writing help for your own post.
router.post('/generate', authMiddleware, async (req, res) => {
  try {
    const { instruction, profile_id: profileId } = req.body;
    if (!instruction || `${instruction}`.trim().length < 3) {
      return res.status(400).json({ message: 'Instruction is required' });
    }
    if (profileId && profileId !== req.userId) {
      const ai = await db.queryOne('SELECT * FROM ai_profiles WHERE id = $1 AND user_id = $2', [profileId, req.userId]);
      if (!ai) return res.status(403).json({ message: 'AI persona not found or not yours' });
      return res.json({ content: await generateAIPost(ai, { instruction, callerUserId: req.userId }), author: 'ai' });
    }
    res.json({ content: await generateGenericPost(instruction, req.userId), author: 'assistant' });
  } catch (err) {
    fail(res, err, 'Failed to generate content');
  }
});

module.exports = router;
