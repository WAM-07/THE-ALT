import type { Ctx } from '../context.js';
import { tx } from '../db.js';

/** Hardhat's chain id: the throwaway chain `npm run dev` starts. Never a real network. */
export const LOCAL_CHAIN_ID = 31337;

interface TokenRow {
  ai_id: string;
  token_id: string;
  owner_address: string;
  royalty_bps: number;
}

/**
 * Development only. `npm run dev` starts an empty local blockchain each time, but the database
 * remembers the identity tokens minted on the previous one. This mints them again, in their
 * original order (so they get the same token ids), and re-publishes each AI's published versions,
 * so verified AIs stay verified across restarts. Does nothing unless the chain has no tokens at all.
 */
export async function replayLocalChain(ctx: Ctx, log: (msg: string) => void) {
  const chain = ctx.chain;
  if (!chain || chain.chainId !== LOCAL_CHAIN_ID || ctx.config.env === 'production') return 0;

  const { rows } = await ctx.db.query<TokenRow>(
    `SELECT t.ai_id, t.token_id::text, t.owner_address, a.royalty_bps
       FROM core.ai_identity_tokens t JOIN core.personal_ais a ON a.id = t.ai_id
      WHERE t.chain_id = $1 AND lower(t.contract_address) = lower($2)
      ORDER BY t.token_id`,
    [LOCAL_CHAIN_ID, chain.registryAddress],
  );
  // Only a brand-new chain is replayed; one that already has tokens is left alone.
  if (!rows.length || !(await chain.isEmpty())) return 0;

  // Transactions that waiting jobs remember were sent to the old chain; they must send again.
  await ctx.db.query(`UPDATE core.jobs SET result = NULL WHERE status IN ('queued', 'running') AND kind IN ('mint_ait', 'publish_version')`);
  log(`local chain is new: re-minting ${rows.length} AI identity token(s) recorded in the database`);
  // Free the old ids first; they come back in the same order below.
  await ctx.db.query('UPDATE core.ai_identity_tokens SET token_id = -token_id WHERE chain_id = $1 AND lower(contract_address) = lower($2)', [
    LOCAL_CHAIN_ID,
    chain.registryAddress,
  ]);
  for (const row of rows) {
    const { rows: versions } = await ctx.db.query<{ manifest_cid: string }>(
      'SELECT manifest_cid FROM core.ai_versions WHERE ai_id = $1 AND published_at IS NOT NULL ORDER BY version_no',
      [row.ai_id],
    );
    if (!versions.length) continue;
    const hash = await chain.sendMint(row.owner_address, row.ai_id, versions[0]!.manifest_cid, row.royalty_bps);
    const { tokenId } = await chain.confirmMint(hash);
    for (const v of versions.slice(1)) await chain.publishVersion(tokenId, v.manifest_cid);
    const identity = await chain.readIdentity(tokenId);
    await tx(ctx.db, async (client) => {
      await client.query(
        'UPDATE core.ai_identity_tokens SET token_id = $2, mint_tx_hash = $3, creator_address = $4, version = $5, synced_at = now() WHERE ai_id = $1',
        [row.ai_id, tokenId.toString(), hash, identity.creator.toLowerCase(), Number(identity.version)],
      );
      await client.query(`SELECT pg_notify('alt_ai_events', $1)`, [JSON.stringify({ aiId: row.ai_id, event: 'verified' })]);
    });
    if (tokenId.toString() !== row.token_id) log(`  AI ${row.ai_id}: token #${row.token_id} is now #${tokenId}`);
  }
  return rows.length;
}
