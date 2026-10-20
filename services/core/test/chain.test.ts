import { randomUUID } from 'node:crypto';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { canonicalBytes, localIpfs, sha256Hex } from '../src/lib/ipfs.js';
import { makeApp, type TestApp } from './helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await makeApp();
});
afterAll(async () => {
  await t.app.close();
});

const someone = () => privateKeyToAccount(generatePrivateKey()).address;

describe('IPFS (Module 6)', () => {
  it('gives the same document the same content id, whatever the key order', async () => {
    const store = localIpfs('.data/test-uploads', 'http://localhost:8080');
    const a = await store.pinJson('m', { b: 2, a: { y: 1, x: [3, 2] } });
    const b = await store.pinJson('m', { a: { x: [3, 2], y: 1 }, b: 2 });
    expect(a.cid).toBe(b.cid);
    expect(a.cid).toMatch(/^bafk/); // CIDv1, raw codec
    expect(a.sha256).toBe(sha256Hex(canonicalBytes({ a: { x: [3, 2], y: 1 }, b: 2 })));
    expect(JSON.parse((await store.getBytes(a.cid)).toString())).toEqual({ a: { x: [3, 2], y: 1 }, b: 2 });
  });

  it('serves pinned content over HTTP and rejects nonsense CIDs', async () => {
    const pinned = await t.app.ctx.ipfs.pinJson('doc', { hello: 'alt' });
    const res = await t.app.inject({ method: 'GET', url: `/ipfs/${pinned.cid}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ hello: 'alt' });
    expect((await t.app.inject({ method: 'GET', url: '/ipfs/not-a-real-cid-at-all' })).statusCode).toBe(400);
  });
});

describe('blockchain (Module 17)', () => {
  it('reports the network and contracts', async () => {
    const res = (await t.app.inject({ method: 'GET', url: '/chain' })).json();
    expect(res).toMatchObject({ enabled: true, chainId: 31337, ipfs: 'local', status: { ok: true } });
    expect(res.contracts.aitRegistry).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it('previews, mints and reads back an AI identity token, then verifies it against IPFS', async () => {
    const chain = t.app.ctx.chain!;
    const creator = someone();
    const aiId = randomUUID();
    const manifest = await t.app.ctx.ipfs.pinJson('manifest', { ai: aiId, version: 1, persona: 'test' });

    const preview = await chain.previewMint(creator, aiId, manifest.cid, 500);
    expect(BigInt(preview.gasEstimate)).toBeGreaterThan(0n);
    expect(preview.paidBy).toContain('ALT');

    const hash = await chain.sendMint(creator, aiId, manifest.cid, 500);
    const { tokenId } = await chain.confirmMint(hash);
    expect(await chain.tokenOfAi(aiId)).toBe(tokenId);

    const identity = await chain.readIdentity(tokenId);
    expect(identity).toMatchObject({ owner: creator, creator, version: 1n, suspended: false, manifestCid: manifest.cid });

    const verify = (await t.app.inject({ method: 'GET', url: `/verify/token/${tokenId}` })).json();
    expect(verify).toMatchObject({
      tokenId: tokenId.toString(),
      owner: creator,
      version: 1,
      manifestReadable: true,
      manifestSha256: manifest.sha256,
      manifest: { ai: aiId, version: 1 },
    });

    const v2 = await t.app.ctx.ipfs.pinJson('manifest', { ai: aiId, version: 2, persona: 'test, refined' });
    const published = await chain.publishVersion(tokenId, v2.cid);
    expect(published.version).toBe(2n);
    expect((await chain.readIdentity(tokenId)).tokenUri).toBe(`ipfs://${v2.cid}`);
  });

  it('turns contract reverts into clear API errors', async () => {
    const chain = t.app.ctx.chain!;
    const aiId = randomUUID();
    const m = await t.app.ctx.ipfs.pinJson('manifest', { ai: aiId, n: 1 });
    await chain.confirmMint(await chain.sendMint(someone(), aiId, m.cid, 0));
    const again = await t.app.ctx.ipfs.pinJson('manifest', { ai: aiId, n: 2 });
    await expect(chain.sendMint(someone(), aiId, again.cid, 0)).rejects.toMatchObject({ code: 'CHAIN_AI_ALREADY_MINTED', status: 409 });
    await expect(chain.sendMint(someone(), randomUUID(), again.cid, 2_000)).rejects.toMatchObject({ code: 'CHAIN_ROYALTY_TOO_HIGH' });
  });
});
