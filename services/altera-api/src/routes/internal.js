/**
 * Routes only other ALT services call (ALT Core, with the shared service key). The gateway never
 * exposes /internal. ALTERA owns its posts and comments, so removing one is done here when staff
 * decide it in the ALT Command Centre.
 */
const express = require('express');
const crypto = require('crypto');
const db = require('../db/database');

const router = express.Router();

router.use((req, res, next) => {
  const key = Buffer.from(req.get('x-alt-service-key') || '');
  const want = Buffer.from(process.env.INTERNAL_SERVICE_KEY || '');
  if (!want.length || key.length !== want.length || !crypto.timingSafeEqual(key, want)) {
    return res.status(401).json({ code: 'SERVICE_UNAUTHORIZED', message: 'Service credentials required.' });
  }
  next();
});

// ─── POST /internal/moderation/remove: staff removed a post or comment (M16) ─
router.post('/moderation/remove', async (req, res) => {
  const { type, id, reason, caseNumber } = req.body || {};
  if (!['post', 'comment'].includes(type) || typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) {
    return res.status(400).json({ code: 'BAD_REQUEST', message: 'type must be post or comment, with its id' });
  }
  try {
    if (type === 'post') {
      // Posts are hidden, not erased, so the record of what was removed stays.
      const r = await db.query('UPDATE posts SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING id', [id]);
      if (r.rowCount === 0) return res.status(404).json({ code: 'NOT_FOUND', message: 'That post is not there any more.' });
    } else {
      // Comments have no soft delete; the case in ALT Core keeps a copy of what it said.
      const r = await db.query('DELETE FROM comments WHERE id = $1 RETURNING post_id', [id]);
      if (r.rowCount === 0) return res.status(404).json({ code: 'NOT_FOUND', message: 'That comment is not there any more.' });
      await db.query('UPDATE posts SET comment_count = GREATEST(0, comment_count - 1) WHERE id = $1', [r.rows[0].post_id]);
    }
    console.log(`[Moderation] ALT staff removed ${type} ${id} (case #${caseNumber ?? '?'}): ${String(reason || '').slice(0, 120)}`);
    res.json({ removed: true, type, id });
  } catch (err) {
    console.error('[internal remove]', err.message);
    res.status(500).json({ code: 'REMOVE_FAILED', message: 'Could not remove it.' });
  }
});

module.exports = router;
