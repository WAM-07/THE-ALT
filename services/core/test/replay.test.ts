import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ChainService } from '../src/lib/chain.js';
import { replayLocalChain } from '../src/jobs/replay-local-chain.js';
import type { Ctx } from '../src/context.js';
import { auth, makeApp, signUp, uniq, type TestApp } from './helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await makeApp();
});
afterAll(async () => {
  await t.app.close();
});

/** A brand-new local chain, as `npm run dev` starts each time. */
function freshChain(registryAddress: string, empty = true) {
  let next = 1n;
  const mints: { aiId: string; cid: string }[] = [];
  const published: { tokenId: bigint; cid: string }[] = [];
  const versions = new Map<bigint, number>();
  const chain = {
    chainId: 31337,
    registryAddress,
    isEmpty: async () => empty,
    sendMint: async (_to: string, aiId: string, cid: string) => {
      mints.push({ aiId, cid });
      return `0x${uniq()}${mints.length}`;
    },
    confirmMint: async () => {
      const tokenId = next++;
      versions.set(tokenId, 1);
      return { tokenId, blockNumber: 1n, gasUsed: 1n };
    },
    publishVersion: async (tokenId: bigint, cid: string) => {
      published.push({ tokenId, cid });
      versions.set(tokenId, versions.get(tokenId)! + 1);
      return { hash: '0x1' };
    },
    readIdentity: async (tokenId: bigint) => ({ tokenId, creator: '0xCreator', owner: '0xOwner', version: BigInt(versions.get(tokenId)!), suspended: false, manifestCid: '', tokenUri: '' }),
  };
  return { chain: chain as unknown as ChainService, mints, published };
}

describe('keeping verified AIs verified when the local dev chain restarts', () => {
  it('re-mints recorded tokens in order and re-publishes their versions', async () => {
    const u = await signUp(t);
    const registry = `0x${uniq()}${'0'.repeat(32)}`;
    const ais: { id: string; cids: string[] }[] = [];
    for (const [i, builds] of [2, 1].entries()) {
      const ai = (await t.app.inject({ method: 'POST', url: '/ais', headers: auth(u.accessToken), payload: { name: `Replay ${i}`, handle: `r${i}_${uniq()}`, consents: { persona_training: true } } })).json();
      for (let b = 0; b < builds; b++) await t.app.inject({ method: 'POST', url: `/ais/${ai.id}/versions`, headers: auth(u.accessToken) });
      const cids = (await t.app.ctx.db.query<{ manifest_cid: string }>('SELECT manifest_cid FROM core.ai_versions WHERE ai_id = $1 ORDER BY version_no', [ai.id])).rows.map((r) => r.manifest_cid);
      expect(cids).toHaveLength(builds);
      await t.app.ctx.db.query('UPDATE core.ai_versions SET published_at = now() WHERE ai_id = $1', [ai.id]);
      await t.app.ctx.db.query(
        `INSERT INTO core.ai_identity_tokens (ai_id, token_id, chain_id, contract_address, creator_address, owner_address, mint_tx_hash, version)
         VALUES ($1, $2, 31337, $3, '0xold', '0xowner', $4, $5)`,
        [ai.id, 5 + i * 2, registry, `0xold${uniq()}`, builds],
      );
      ais.push({ id: ai.id, cids });
    }

    const { chain, mints, published } = freshChain(registry);
    const ctx: Ctx = { ...t.app.ctx, chain };
    expect(await replayLocalChain(ctx, () => {})).toBe(2);

    expect(mints).toEqual([{ aiId: ais[0]!.id, cid: ais[0]!.cids[0] }, { aiId: ais[1]!.id, cid: ais[1]!.cids[0] }]);
    expect(published).toEqual([{ tokenId: 1n, cid: ais[0]!.cids[1] }]);
    const { rows } = await t.app.ctx.db.query('SELECT ai_id, token_id::int AS token, version FROM core.ai_identity_tokens WHERE contract_address = $1 ORDER BY token_id', [registry]);
    expect(rows).toEqual([
      { ai_id: ais[0]!.id, token: 1, version: 2 },
      { ai_id: ais[1]!.id, token: 2, version: 1 },
    ]);
  });

  it('leaves a chain that already has tokens alone', async () => {
    const { chain, mints } = freshChain(`0x${uniq()}${'0'.repeat(32)}`, false);
    expect(await replayLocalChain({ ...t.app.ctx, chain }, () => {})).toBe(0);
    expect(mints).toEqual([]);
  });
});
