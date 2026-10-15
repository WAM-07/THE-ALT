import { aitRegistryAbi, altMarketplaceAbi } from '@alt/contracts/abi';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { createPublicClient, createWalletClient, defineChain, http, parseEther, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest';
import { buildApp, coreModeration } from '../src/app.js';
import { createServer } from 'node:http';
import { createChainReader } from '../src/chain.js';
import { loadConfig } from '../src/config.js';
import { indexMarketplace } from '../src/indexer.js';

const chainCfg = inject('chain');
const chain = defineChain({ id: 31337, name: 'test', nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 }, rpcUrls: { default: { http: [chainCfg.rpcUrl] } } });
const pub = createPublicClient({ chain, transport: http() });
const relayer = createWalletClient({ chain, account: privateKeyToAccount(chainCfg.relayerPrivateKey as Hex), transport: http() });
const registry = chainCfg.registry as Hex;
const market = chainCfg.marketplace as Hex;

let app: Awaited<ReturnType<typeof buildApp>>;
let db: pg.Pool;
let sign: (userId: string, sessionId: string) => Promise<string>;

const filed: Record<string, unknown>[] = [];

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
  const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: inject('databaseUrl'), CHAIN_RPC_URL: chainCfg.rpcUrl, AIT_REGISTRY_ADDRESS: registry, ALT_MARKETPLACE_ADDRESS: market, INTERNAL_SERVICE_KEY: 'test-internal-service-key-0123456789abcdef' });
  // Reviews are moderated by ALT Core in real life; here anything containing "BADWORD" is flagged.
  const moderate = async (text: string) => ({ flagged: text.includes('BADWORD') });
  // Reports go to ALT Core's case queue in real life; here they are collected.
  const fileCase = async (c: Record<string, unknown>) => {
    filed.push(c);
    return { caseId: 'case-1', number: filed.length, merged: false };
  };
  app = await buildApp(config, { keySet: createLocalJWKSet({ keys: [jwk] }), logger: false, indexer: false, moderate, fileCase });
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

    // A subscription price alone (on-chain, like every price) makes a listing.
    await wait(await seller.wallet.writeContract({ address: market, abi: altMarketplaceAbi, functionName: 'listForSubscription', args: [tokenId, parseEther('1.5')] }));
    const sub = (await req('PUT', `/listings/${aiId}`, seller.token, { pitch: 'Great AI' })).json().listing;
    expect(sub).toMatchObject({ tokenId: tokenId.toString(), pitch: 'Great AI', sale: null, rent: null, subscription: { pricePerMonth: { pol: '1.5' } } });

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
    expect((await req('PUT', `/listings/${draft}`, p.token, { pitch: 'Mine' })).json().error.code).toBe('AI_NOT_VERIFIED');

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

describe('marketplace history', () => {
  it('records sales, resales (with the creator royalty) and rentals from the contract events', async () => {
    const reader = createChainReader({ rpcUrl: chainCfg.rpcUrl, registry, marketplace: market });
    const index = () => indexMarketplace(db, reader);
    await index(); // catch up with earlier tests
    const [creator, buyer, third, renter] = [await person(), await person(), await person(), await person()];
    const { aiId, tokenId } = await verifiedAi(creator);
    const buy = (who: Person, price: string) => who.wallet.writeContract({ address: market, abi: altMarketplaceAbi, functionName: 'buy', args: [tokenId], value: parseEther(price) });

    // The creator sells to the buyer (no royalty on a creator's own sale).
    await wait(await creator.wallet.writeContract({ address: market, abi: altMarketplaceAbi, functionName: 'listForSale', args: [tokenId, parseEther('1')] }));
    await req('PUT', `/listings/${aiId}`, creator.token, { pitch: 'First owner' });
    await wait(await buy(buyer, '1'));
    await db.query('UPDATE core.personal_ais SET owner_id = $2 WHERE id = $1', [aiId, buyer.user]); // what ALT Core does on the Transfer
    expect(await index()).toBe(1);
    expect(await index()).toBe(0); // reading the same blocks again changes nothing
    // The seller's listing (and subscription price) left with the sale.
    expect((await db.query('SELECT 1 FROM altar.listings WHERE ai_id = $1', [aiId])).rowCount).toBe(0);

    // The buyer resells to a third person: the creator earns the royalty (5%).
    await wait(await buyer.wallet.writeContract({ address: registry, abi: aitRegistryAbi, functionName: 'setApprovalForAll', args: [market, true] }));
    await wait(await buyer.wallet.writeContract({ address: market, abi: altMarketplaceAbi, functionName: 'listForSale', args: [tokenId, parseEther('2')] }));
    await wait(await buy(third, '2'));
    await db.query('UPDATE core.personal_ais SET owner_id = $2 WHERE id = $1', [aiId, third.user]);

    // The third person rents it out; someone rents it for a day.
    await wait(await third.wallet.writeContract({ address: registry, abi: aitRegistryAbi, functionName: 'setApprovalForAll', args: [market, true] }));
    await wait(await third.wallet.writeContract({ address: market, abi: altMarketplaceAbi, functionName: 'listForRent', args: [tokenId, parseEther('0.1'), 3] }));
    await wait(await renter.wallet.writeContract({ address: market, abi: altMarketplaceAbi, functionName: 'rent', args: [tokenId, 1], value: parseEther('0.1') }));
    expect(await index()).toBe(2);

    const history = (await req('GET', `/activity?aiId=${aiId}`)).json();
    expect(history.map((h: { kind: string; amount: { pol: string } }) => `${h.kind} ${h.amount.pol}`)).toEqual(['rental 0.1', 'sale 2', 'sale 1']);
    expect(history[1]).toMatchObject({ royalty: { pol: '0.1' }, from: { handle: expect.stringMatching(/^p_/) } });
    expect(history[2].royalty.pol).toBe('0');

    const roles = async (p: Person) => (await req('GET', '/me/activity', p.token)).json().map((h: { role: string }) => h.role);
    // The creator earns on the resale and on the rental too (someone else is paid both times).
    expect(await roles(creator)).toEqual(['royalty', 'royalty', 'sold']);
    expect(history[0].royalty.pol).toBe('0.005');
    expect(await roles(buyer)).toEqual(['sold', 'bought']);
    expect(await roles(third)).toEqual(['rented_out', 'bought']);
    expect(await roles(renter)).toEqual(['rented']);
    const rentals = (await req('GET', '/me/rentals', renter.token)).json();
    expect(rentals).toEqual([expect.objectContaining({ kind: 'rental', days: 1, ai: expect.objectContaining({ id: aiId }) })]);
  });
});

describe('subscriptions, reviews and royalties', () => {
  it('records subscriptions, lets real customers review, and shows the creator their royalties', async () => {
    const reader = createChainReader({ rpcUrl: chainCfg.rpcUrl, registry, marketplace: market });
    const index = () => indexMarketplace(db, reader);
    await index();
    const [creator, owner, fan, stranger] = [await person(), await person(), await person(), await person()];
    const { aiId, tokenId } = await verifiedAi(creator);

    // The creator sells it; the new owner offers it by the month and a fan subscribes for 2 months.
    await wait(await creator.wallet.writeContract({ address: market, abi: altMarketplaceAbi, functionName: 'listForSale', args: [tokenId, parseEther('1')] }));
    await wait(await owner.wallet.writeContract({ address: market, abi: altMarketplaceAbi, functionName: 'buy', args: [tokenId], value: parseEther('1') }));
    await db.query('UPDATE core.personal_ais SET owner_id = $2 WHERE id = $1', [aiId, owner.user]);
    await wait(await owner.wallet.writeContract({ address: market, abi: altMarketplaceAbi, functionName: 'listForSubscription', args: [tokenId, parseEther('0.2')] }));
    await wait(await fan.wallet.writeContract({ address: market, abi: altMarketplaceAbi, functionName: 'subscribe', args: [tokenId, 2], value: parseEther('0.4') }));
    expect(await index()).toBe(2);

    // Subscribers stay private: the public history shows the sale, and the listing only counts them.
    const history = (await req('GET', `/activity?aiId=${aiId}`)).json();
    expect(history.map((h: { kind: string }) => h.kind)).toEqual(['sale']);
    await req('PUT', `/listings/${aiId}`, owner.token, { pitch: 'By the month' });
    expect((await req('GET', `/listings/${aiId}`)).json().activeSubscribers).toBe(1);
    const mine = (await req('GET', '/me/activity', fan.token)).json();
    expect(mine[0]).toMatchObject({ kind: 'subscription', months: 2, amount: { pol: '0.4' }, royalty: { pol: '0.02' } });
    expect((await req('GET', '/me/activity', fan.token)).json()[0].role).toBe('subscribed');
    expect((await req('GET', '/me/activity', owner.token)).json()[0].role).toBe('subscribed_out');
    expect((await req('GET', '/me/rentals', fan.token)).json()).toEqual([expect.objectContaining({ kind: 'subscription', months: 2 })]);
    expect((await req('GET', `/listings/${aiId}`)).json().subscription.pricePerMonth.pol).toBe('0.2');

    // The creator sees royalties per AI.
    const royalties = (await req('GET', '/me/royalties', creator.token)).json();
    expect(royalties).toMatchObject({ total: { pol: '0.02' }, ais: [expect.objectContaining({ aiId, payments: 1 })] });

    // Reviews: only customers, never the owner or creator, and moderated.
    expect((await req('GET', `/me/reviews/${aiId}`, stranger.token)).json()).toMatchObject({ canReview: false, review: null });
    expect((await req('PUT', `/reviews/${aiId}`, stranger.token, { rating: 5 })).json().error.code).toBe('NOT_A_CUSTOMER');
    expect((await req('PUT', `/reviews/${aiId}`, creator.token, { rating: 5 })).json().error.code).toBe('OWN_AI');
    expect((await req('PUT', `/reviews/${aiId}`, fan.token, { rating: 6 })).statusCode).toBe(400);
    expect((await req('PUT', `/reviews/${aiId}`, fan.token, { rating: 1, body: 'BADWORD here' })).json().error.code).toBe('REVIEW_REJECTED');
    const review = (await req('PUT', `/reviews/${aiId}`, fan.token, { rating: 4, body: 'Helpful and kind.' })).json();
    expect(review).toMatchObject({ rating: 4, basis: 'subscribed', reviewer: { id: fan.user } });
    await req('PUT', `/reviews/${aiId}`, fan.token, { rating: 5, body: 'Even better the second week.' });

    // Anyone signed in can report a review to ALT staff, with a snapshot of it; never their own.
    expect((await req('POST', `/reviews/${aiId}/${fan.user}/report`, fan.token, { reason: 'spam' })).json().error.code).toBe('OWN_REVIEW');
    expect((await req('POST', `/reviews/${aiId}/${fan.user}/report`, stranger.token, { reason: 'shouting' })).statusCode).toBe(400);
    const reported = await req('POST', `/reviews/${aiId}/${fan.user}/report`, stranger.token, { reason: 'fake', details: 'Copied from another AI.' });
    expect(reported.json()).toMatchObject({ received: true });
    // ALT staff decided to remove it: ALT Core asks ALTAR, with the service key.
    const removeReview = (key?: string) =>
      app.inject({
        method: 'POST',
        url: '/internal/reviews/remove',
        headers: key ? { 'x-alt-service-key': key, 'x-alt-service': 'core' } : {},
        payload: { aiId, reviewerId: fan.user, reason: 'Fake', caseNumber: 3 },
      });
    expect((await removeReview()).statusCode).toBe(401);
    expect((await removeReview('test-internal-service-key-0123456789abcdef')).json()).toEqual({ removed: true });
    expect((await removeReview('test-internal-service-key-0123456789abcdef')).statusCode).toBe(404);
    await req('PUT', `/reviews/${aiId}`, fan.token, { rating: 5, body: 'Even better the second week.' });
    expect(filed.at(-1)).toMatchObject({
      kind: 'report',
      category: 'fake',
      reporterId: stranger.user,
      subject: { type: 'review', id: `${aiId}:${fan.user}`, aiId, userId: fan.user },
      evidence: { rating: 5, text: 'Even better the second week.', basis: 'subscribed' },
    });
    expect((await req('PUT', `/reviews/${aiId}`, owner.token, { rating: 5 })).json().error.code).toBe('OWN_AI');

    const all = (await req('GET', `/reviews?aiId=${aiId}`)).json();
    expect(all).toMatchObject({ average: 5, count: 1, reviews: [expect.objectContaining({ body: 'Even better the second week.' })] });
    expect((await req('GET', '/ratings')).json()).toEqual(expect.arrayContaining([{ aiId, average: 5, count: 1 }]));
    expect((await req('GET', `/me/reviews/${aiId}`, fan.token)).json()).toMatchObject({ canReview: true, basis: 'subscribed', review: { rating: 5 } });

    expect((await req('DELETE', `/reviews/${aiId}`, fan.token)).statusCode).toBe(204);
    expect((await req('GET', `/reviews?aiId=${aiId}`)).json()).toMatchObject({ average: null, count: 0 });
  });
});

describe("ALT Core's moderation", () => {
  it('is called as the "altar" service, with the service key', async () => {
    // A stand-in for Core's /internal/moderate that, like Core, needs both headers.
    const seen: Record<string, unknown>[] = [];
    const server = createServer((r, res) => {
      seen.push(r.headers);
      const ok = r.headers['x-alt-service'] === 'altar' && r.headers['x-alt-service-key'] === 'service-key';
      res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' }).end(JSON.stringify(ok ? { flagged: false } : { error: {} }));
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const { port } = server.address() as { port: number };
    try {
      expect(await coreModeration({ coreUrl: `http://127.0.0.1:${port}`, internalServiceKey: 'service-key' })('hello')).toEqual({ flagged: false });
      await expect(coreModeration({ coreUrl: `http://127.0.0.1:${port}`, internalServiceKey: 'wrong' })('hello')).rejects.toMatchObject({ code: 'MODERATION_UNAVAILABLE' });
      await expect(coreModeration({ coreUrl: `http://127.0.0.1:${port}`, internalServiceKey: null })('hello')).rejects.toMatchObject({ code: 'MODERATION_UNAVAILABLE' });
      expect(seen).toHaveLength(2);
    } finally {
      server.close();
    }
  });
});
