const db = require('../db/database');

/**
 * Keeps ALTERA's copy of a linked AI in step with ALT Core: name, picture, category, whether it is
 * verified (identity token minted and not suspended) and who owns it. When an AI is sold on ALTAR its
 * persona moves to the new owner, with auto-replies off until they choose. ALTERA reads core.* but
 * never writes to it; only Core can make an AI verified or change its owner.
 */
async function syncLinkedAi(coreAiId) {
  const row = await db.queryOne(
    `SELECT a.id, a.name, a.description, a.avatar_url, a.category, a.status, a.health_score, a.deleted_at, a.owner_id,
            t.token_id, t.suspended
       FROM core.personal_ais a
       LEFT JOIN core.ai_identity_tokens t ON t.ai_id = a.id
      WHERE a.id = $1`,
    [coreAiId]
  );
  if (!row) return null;
  const verified = row.status === 'verified' && row.token_id !== null && !row.suspended && !row.deleted_at;
  const { rows } = await db.query(
    `UPDATE ai_profiles
        SET display_name = $2, avatar = COALESCE($3, avatar), category = $4, is_verified = $5,
            ait_token_id = $6, health_score = $7, bio = COALESCE(NULLIF(bio, ''), $8),
            autonomy_enabled = CASE WHEN user_id <> $9 THEN false ELSE autonomy_enabled END,
            user_id = $9
      WHERE core_ai_id = $1
      RETURNING id, is_verified, user_id`,
    [coreAiId, row.name, row.avatar_url, row.category, verified, row.token_id === null ? null : String(row.token_id), row.health_score, row.description, row.owner_id]
  );
  return rows[0] || null;
}

async function syncAllLinkedAis() {
  const linked = await db.queryMany('SELECT core_ai_id FROM ai_profiles WHERE core_ai_id IS NOT NULL');
  for (const { core_ai_id: id } of linked) await syncLinkedAi(id).catch((err) => console.error('[ai-sync]', id, err.message));
  return linked.length;
}

module.exports = { syncLinkedAi, syncAllLinkedAis };
