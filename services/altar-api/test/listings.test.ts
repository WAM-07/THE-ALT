import { aitRegistryAbi, altMarketplaceAbi } from '@alt/contracts/abi';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { createPublicClient, createWalletClient, defineChain, http, parseEther, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

const chainCfg = inject('chain');
const chain = defineChain({ id: 31337, name: 'test', nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 }, rpcUrls: { default: { http: [chainCfg.rpcUrl] } } });
const pub = createPublicClient({ chain, transport: http() });
const relayer = createWalletClient({ chain, account: privateKeyToAccount(chainCfg.relayerPrivateKey as Hex), transport: http() });
const registry = chainCfg.registry as Hex;
const market = chainCfg.marketplace as Hex;

let app: Awaited<ReturnType<typeof buildApp>>;
let db: pg.Pool;
let sign: (userId: string, sessionId: string) => Promise<string>;

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test', alg: 'RS256' };
  sign = (userId, sessionId) =>
    new SignJWT({ sid: sessionId })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setSubject(userId)
      .setIssuer('http://localhost:8080/core')
      .setAudience('alt')
      .setExpirationTime('10m')
      .sign(privateKey);
  const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: inject('databaseUrl'), CHAIN_RPC_URL: chainCfg.rpcUrl, AIT_REGISTRY_ADDRESS: registry, ALT_MARKETPLACE_ADDRESS: market });
  app = await buildApp(config, { keySet: createLocalJWKSet({ keys: [jwk] }), logger: false });
  await app.ready();
  db = new pg.Pool({ connectionString: inject('databaseUrl') });
});
afterAll(async () => {
  await app.close();
  await db.end();
});

const wait = (hash: Hex) => pub.waitForTransactionReceipt({ hash });
const bytes32 = (uuid: string) => `0x${uuid.replace(/-/g, '').padStart(64, '0')}` as Hex;

/** A person in ALT Core with a signed-in ALTAR session and a funded wallet they control. */
async function person() {
  const id = randomBytes(4).toString('hex');
  const account = privateKeyToAccount(generatePrivateKey());
  const user = (await db.query(`INSERT INTO core.users (handle, display_name) VALUES ($1, $2) RETURNING id`, [`p_${id}`, `Person ${id}`])).rows[0].id as string;
  await db.query(`INSERT INTO core.wallets (user_id, address, kind, private_key_enc, is_primary) VALUES ($1, $2, 'custodial', 'test', true)`, [user, account.address.toLowerCase()]);
  const session = (
    await db.query(`INSERT INTO core.sessions (user_id, platform, refresh_hash, expires_at) VALUES ($1, 'altar', $2, now() + interval '1 hour') RETURNING id`, [
      user,
      randomBytes(16).toString('hex'),
    ])
  ).rows[0].id as string;
  await wait(await relayer.sendTransaction({ to: account.address, value: parseEther('5') }));
  return { user, session, token: await sign(user, session), account, wallet: createWalletClient({ chain, account, transport: http() }) };
}
type Person = Awaited<ReturnType<typeof person>>;

/** A verified AI owned by `p`, minted on the test chain. */
async function verifiedAi(p: Person) {
  const aiId = randomUUID();
  await db.query(`INSERT INTO core.personal_ais (id, owner_id, creator_id, handle, name, status) VALUES ($1, $2, $2, $3, 'Test AI', 'verified')`, [
    aiId,
    p.user,
    `ai_${randomBytes(4).toString('hex')}`,
  ]);
  const mint = await relayer.writeContract({ address: registry, abi: aitRegistryAbi, functionName: 'mint', args: [p.account.address, bytes32(aiId), `bafy${aiId.replace(/-/g, '')}`, 500n] });
  await wait(mint);
  const tokenId = await pub.readContract({ address: registry, abi: aitRegistryAbi, functionName: 'tokenOfAi', args: [bytes32(aiId)] });
  await db.query(
    `INSERT INTO core.ai_identity_tokens (ai_id, token_id, chain_id, contract_address, creator_address, owner_address, mint_tx_hash) VALUES ($1, $2, 31337, $3, $4, $4, $5)`,
    [aiId, tokenId.toString(), registry.toLowerCase(), p.account.address.toLowerCase(), mint],
  );
  await wait(await p.wallet.writeContract({ address: registry, abi: aitRegistryAbi, functionName: 'setApprovalForAll', args: [market, true] }));
  return { aiId, tokenId };
}

const req = (method: string, url: string, token?: string, payload?: object) =>
  app.inject({ method: method as 'GET', url, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(payload ? { payload } : {}) });

describe('listings', () => {
  it("mirrors the on-chain offer and keeps the seller's description and subscription price", async () => {
    const seller = await person();
    const { aiId, tokenId } = await verifiedAi(seller);

    expect((await req('PUT', `/listings/${aiId}`, undefined, { pitch: 'Hi' })).statusCode).toBe(401);
    const stranger = await person();
    expect((await req('PUT', `/listings/${aiId}`, stranger.token, { pitch: 'Mine now' })).statusCode).toBe(404);

    // Nothing on offer yet: no listing.
    expect((await req('PUT', `/listings/${aiId}`, seller.token, { pitch: 'Great AI' })).json()).toEqual({ listing: null });

    // A subscription price alone makes a listing (subscribing itself opens later).
    const sub = (await req('PUT', `/listings/${aiId}`, seller.token, { pitch: 'Great AI', subscriptionPrice: '1.5' })).json().listing;
    expect(sub).toMatchObject({ tokenId: tokenId.toString(), pitch: 'Great AI', sale: null, rent: null, subscription: { pricePerMonth: { pol: '1.5' }, open: false } });

    // The seller lists on-chain (through ALT Core in real life); ALTAR reads it back.
    await wait(await seller.wallet.writeContract({ address: market, abi: altMarketplaceAbi, functionName: 'listForSale', args: [tokenId, parseEther('3')] }));
    await wait(await seller.wallet.writeContract({ address: market, abi: altMarketplaceAbi, functionName: 'listForRent', args: [tokenId, parseEther('0.2'), 14] }));
    const synced = (await req('PUT', `/listings/${aiId}`, seller.token, { terms: 'No refunds.' })).json().listing;
    expect(synced).toMatchObject({ pitch: 'Great AI', terms: 'No refunds.', sale: { price: { pol: '3' } }, rent: { pricePerDay: { pol: '0.2' }, maxDays: 14 } });

    expect((await req('GET', '/listings')).json()).toEqual(expect.arrayContaining([expect.objectContaining({ aiId, sale: { price: { wei: parseEther('3').toString(), pol: '3' } } })]));
    expect((await req('GET', `/listings/${aiId}`)).json().terms).toBe('No refunds.');
    expect((await req('DELETE', `/listings/${aiId}`, seller.token)).json().error.code).toBe('STILL_ON_CHAIN');

    // Once the token leaves the seller's wallet, they can't edit the listing and it leaves ALTAR.
    await wait(await seller.wallet.writeContract({ address: registry, abi: aitRegistryAbi, functionName: 'transferFrom', args: [seller.account.address, stranger.account.address, tokenId] }));
    expect((await req('PUT', `/listings/${aiId}`, seller.token, { pitch: 'Still mine?' })).json().error.code).toBe('OWNERSHIP_OUT_OF_SYNC');
    await db.query('UPDATE core.personal_ais SET owner_id = $2 WHERE id = $1', [aiId, stranger.user]);
    expect((await req('GET', `/listings/${aiId}`)).statusCode).toBe(404);
  });

  it('refuses drafts and signed-out sessions', async () => {
    const p = await person();
    const draft = randomUUID();
    await db.query(`INSERT INTO core.personal_ais (id, owner_id, creator_id, handle, name) VALUES ($1, $2, $2, $3, 'Draft')`, [draft, p.user, `d_${randomBytes(4).toString('hex')}`]);
    expect((await req('PUT', `/listings/${draft}`, p.token, { subscriptionPrice: '1' })).json().error.code).toBe('AI_NOT_VERIFIED');

    expect((await req('GET', '/wishlist', p.token)).statusCode).toBe(200);
    // Signing out (Core revokes the session and announces it) works here at once, despite the cache.
    await db.query('UPDATE core.sessions SET revoked_at = now() WHERE id = $1', [p.session]);
    await db.query(`SELECT pg_notify('alt_sessions_revoked', $1)`, [JSON.stringify({ sessionId: p.session, userId: p.user })]);
    await new Promise((r) => setTimeout(r, 200));
    expect((await req('GET', '/wishlist', p.token)).json().error.code).toBe('SESSION_REVOKED');
  });
});

describe('saved AIs', () => {
  it('saves, lists and unsaves verified AIs only', async () => {
    const p = await person();
    const owner = await person();
    const { aiId } = await verifiedAi(owner);
    expect((await req('PUT', `/wishlist/${aiId}`, p.token)).statusCode).toBe(204);
    expect((await req('PUT', `/wishlist/${aiId}`, p.token)).statusCode).toBe(204);
    expect((await req('GET', '/wishlist', p.token)).json()).toEqual([{ aiId, savedAt: expect.any(String) }]);
    expect((await req('PUT', `/wishlist/${randomUUID()}`, p.token)).statusCode).toBe(404);
    expect((await req('DELETE', `/wishlist/${aiId}`, p.token)).statusCode).toBe(204);
    expect((await req('GET', '/wishlist', p.token)).json()).toEqual([]);
  });
});
