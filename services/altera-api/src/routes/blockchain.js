const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const db = require('../db/database');
const core = require('../services/core_client');

/**
 * On-chain identity of AIs on ALTERA (M13-FE-3, M17). Nothing here is simulated: answers come from
 * ALT Core's independent check of the AIT registry contract and the IPFS manifest.
 */
const router = express.Router();

const fail = (res, err) =>
  res.status(err.status && err.status < 600 ? err.status : 502).json({ message: err.message || 'Blockchain lookup failed', code: err.code });

// GET /blockchain/verify-ait/:tokenId — the token as recorded on-chain, with its manifest
router.get('/verify-ait/:tokenId', authMiddleware, async (req, res) => {
  try {
    if (!/^\d+$/.test(req.params.tokenId)) return res.status(400).json({ message: 'Token id must be a number' });
    const token = await core.verifyToken(req.params.tokenId);
    res.json({ ...token, verified: !token.suspended && token.manifestReadable });
  } catch (err) {
    fail(res, err);
  }
});

// GET /blockchain/ai/:profileId — on-chain identity of an ALTERA AI persona
router.get('/ai/:profileId', authMiddleware, async (req, res) => {
  try {
    const ai = await db.queryOne('SELECT id, username, ait_token_id, is_verified, core_ai_id FROM ai_profiles WHERE id = $1', [req.params.profileId]);
    if (!ai) return res.status(404).json({ message: 'AI not found' });
    if (!ai.core_ai_id || !ai.ait_token_id) {
      return res.json({ verified: false, reason: 'This AI was not created and verified in ALTER, so it has no identity token.' });
    }
    const token = await core.verifyToken(ai.ait_token_id);
    res.json({ verified: ai.is_verified && !token.suspended, ...token });
  } catch (err) {
    fail(res, err);
  }
});

// GET /blockchain/wallet-ait/:address — AI identity tokens held by a wallet (as mirrored by ALT Core)
router.get('/wallet-ait/:address', authMiddleware, async (req, res) => {
  try {
    const address = `${req.params.address}`.toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(address)) return res.status(400).json({ message: 'Not a wallet address' });
    const rows = await db.queryMany(
      `SELECT t.token_id, t.chain_id, t.contract_address, t.version, t.suspended, a.handle, a.name
         FROM core.ai_identity_tokens t JOIN core.personal_ais a ON a.id = t.ai_id
        WHERE t.owner_address = $1 ORDER BY t.minted_at`,
      [address]
    );
    res.json(rows.map((r) => ({
      token_id: String(r.token_id),
      chain_id: r.chain_id,
      contract: r.contract_address,
      version: r.version,
      suspended: r.suspended,
      ai: { handle: r.handle, name: r.name },
    })));
  } catch (err) {
    fail(res, err);
  }
});

module.exports = router;
