import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest';
import type { Hex } from 'viem';
import { decrypt } from '../src/lib/crypto.js';
import type { LlmProvider } from '../src/modules/ai/llm.js';
import { indexRegistry, syncToken } from '../src/modules/market/holders.js';
import { auth, makeApp, signUp, uniq, type TestApp } from './helpers.js';

const echo: LlmProvider = {
  name: 'echo',
  async complete(messages) {
    return { text: `reply to: ${messages[messages.length - 1]!.content.slice(0, 30)}`, provider: 'echo', model: 'echo-1' };
  },
};

let t: TestApp;
beforeAll(async () => {
  t = await makeApp({ CLEARANCE_MIN_TEST_MESSAGES: '1' }, { llmProviders: [echo] });
});
afterAll(async () => {
  await t.app.close();
});

const call = (method: string, url: string, token: string, payload?: object) => t.app.inject({ method: method as 'GET', url, headers: auth(token), payload });
type User = Awaited<ReturnType<typeof signUp>>;
const pw = (u: User) => ({ confirm: { password: u.password } });
const earnings = async (u: User) => Number((await call('GET', '/me/wallet', u.accessToken)).json().earnings.pol);

async function funded() {
  const u = await signUp(t);
  await call('POST', '/me/wallet/test-funds', u.accessToken);
  return u;
}

/** Builds, tests and mints an AI the way ALTER does (5% creator royalty), with one private note. */
async function verifiedAi(owner: User) {
  const ai = (
    await call('POST', '/ais', owner.accessToken, {
      name: 'Market AI',
      handle: `ai_${uniq()}`,
      royaltyBps: 500,
      onboarding: { about: 'For sale.', primaryTrait: 'Calm' },
      consents: { persona_training: true, third_party_processing: true, public_deployment: true },
    })
  ).json();
  await call('POST', `/ais/${ai.id}/datasets`, owner.accessToken, { title: 'My private diary', category: 'personality', text: 'Only for me: my bank PIN hint is the cat.' });
  await call('POST', `/ais/${ai.id}/versions`, owner.accessToken);
  const s = (await call('POST', `/ais/${ai.id}/chat/sessions`, owner.accessToken, {})).json();
  await call('POST', `/ais/${ai.id}/chat/sessions/${s.id}/messages`, owner.accessToken, { content: 'hello' });
  await call('POST', `/ais/${ai.id}/confirm`, owner.accessToken, { confirmed: true });
  await call('POST', `/ais/${ai.id}/deploy`, owner.accessToken);
  await t.app.jobs.drain();
  return (await call('GET', `/ais/${ai.id}`, owner.accessToken)).json();
}

describe('buying, reselling and renting an AI', () => {
  it('moves ownership with the token, pays the creator a royalty on resale, and lets a renter talk until the rental ends', async () => {
    const [a, b, c, d, stranger] = [await signUp(t), await funded(), await funded(), await funded(), await funded()];
    const ai = await verifiedAi(a);
    const tokenId = BigInt(ai.token.tokenId);

    // 1. A lists it for 10 POL and B buys it.
    await call('PUT', `/ais/${ai.id}/market`, a.accessToken, { sale: { price: '10' }, rent: null, ...pw(a) });
    expect((await call('POST', `/ais/${ai.id}/market/buy`, a.accessToken, pw(a))).json().error.code).toBe('ALREADY_YOURS');
    expect((await call('POST', `/ais/${ai.id}/market/buy`, b.accessToken, { ...pw(b), expectedPrice: '9' })).json().error.code).toBe('PRICE_CHANGED');
    const bought = await call('POST', `/ais/${ai.id}/market/buy`, b.accessToken, { ...pw(b), expectedPrice: '10' });
    expect(bought.statusCode).toBe(200);

    // B owns it everywhere now; A has lost access. A's private files stay sealed from B.
    expect((await call('GET', `/ais/${ai.id}`, b.accessToken)).statusCode).toBe(200);
    expect((await call('GET', `/ais/${ai.id}`, a.accessToken)).statusCode).toBe(404);
    expect((await call('GET', '/ais', b.accessToken)).json().map((x: { id: string }) => x.id)).toContain(ai.id);
    expect((await call('GET', `/ais/${ai.id}/datasets`, b.accessToken)).json()).toEqual([]);
    expect((await call('GET', '/me', b.accessToken)).json().roles).toContain('consumer');
    const bInbox = JSON.stringify((await call('GET', '/notifications', b.accessToken)).json());
    expect(bInbox).toContain('is yours');
    expect(JSON.stringify((await call('GET', '/notifications', a.accessToken)).json())).toContain('has a new owner');
    expect((await call('PUT', `/ais/${ai.id}/market`, a.accessToken, { sale: { price: '1' }, rent: null, ...pw(a) })).statusCode).toBe(404);

    // 2. B resells it to C for 20 POL: A, the creator, earns 5% automatically.
    const aBefore = await earnings(a);
    await call('PUT', `/ais/${ai.id}/market`, b.accessToken, { sale: { price: '20' }, rent: null, ...pw(b) });
    expect((await call('POST', `/ais/${ai.id}/market/buy`, c.accessToken, pw(c))).statusCode).toBe(200);
    expect((await earnings(a)) - aBefore).toBeCloseTo(1);
    const feeBps = (await call('GET', '/me/wallet', b.accessToken)).json().platformFeeBps;
    expect(await earnings(b)).toBeCloseTo(20 - 1 - (20 * feeBps) / 10_000);

    // 3. C rents it out; D rents it for one day and talks to it. Strangers can't.
    await call('PUT', `/ais/${ai.id}/market`, c.accessToken, { sale: null, rent: { pricePerDay: '1', maxDays: 3 }, ...pw(c) });
    expect((await call('POST', `/ais/${ai.id}/market/rent`, d.accessToken, { days: 5, ...pw(d) })).json().error.code).toBe('TOO_MANY_DAYS');
    const rented = await call('POST', `/ais/${ai.id}/market/rent`, d.accessToken, { days: 1, ...pw(d) });
    expect(rented.statusCode).toBe(200);
    expect(new Date(rented.json().until).getTime()).toBeGreaterThan(Date.now());
    expect((await call('POST', `/ais/${ai.id}/market/rent`, stranger.accessToken, { days: 1, ...pw(stranger) })).json().error.code).toBe('ALREADY_RENTED');
    // Renting never moves ownership.
    expect((await call('GET', `/ais/${ai.id}`, c.accessToken)).statusCode).toBe(200);

    expect((await call('GET', `/ais/${ai.id}/access`, d.accessToken)).json().role).toBe('renter');
    expect((await call('GET', `/ais/${ai.id}/access`, c.accessToken)).json().role).toBe('owner');
    expect((await call('GET', `/ais/${ai.id}/access`, stranger.accessToken)).json().role).toBeNull();
    expect((await call('POST', `/ais/${ai.id}/conversations`, stranger.accessToken)).json().error.code).toBe('NO_ACCESS');

    const convo = (await call('POST', `/ais/${ai.id}/conversations`, d.accessToken)).json();
    const said = await call('POST', `/ais/${ai.id}/conversations/${convo.id}/messages`, d.accessToken, { content: 'Hi there' });
    expect(said.statusCode).toBe(200);
    expect(said.json().reply.content).toContain('reply to: Hi there');
    // The owner can't read the renter's conversation.
    expect((await call('GET', `/ais/${ai.id}/conversations/${convo.id}/messages`, c.accessToken)).statusCode).toBe(404);

    // 4. The rental ends: the chain stops naming D, and D can read the old conversation but not talk.
    await rpc('evm_increaseTime', [2 * 86_400]);
    await rpc('evm_mine', []);
    await syncToken(t.app.ctx, tokenId);
    expect((await call('GET', `/ais/${ai.id}/access`, d.accessToken)).json().role).toBeNull();
    expect((await call('POST', `/ais/${ai.id}/conversations/${convo.id}/messages`, d.accessToken, { content: 'Still there?' })).json().error.code).toBe('NO_ACCESS');
    expect((await call('GET', `/ais/${ai.id}/conversations/${convo.id}/messages`, d.accessToken)).json()).toHaveLength(2);
  });

  it('follows the token when it moves outside ALTAR', async () => {
    const [owner, friend] = [await signUp(t), await signUp(t)];
    const ai = await verifiedAi(owner);
    const { rows } = await t.app.ctx.db.query(`SELECT private_key_enc FROM core.wallets WHERE user_id = $1 AND kind = 'custodial'`, [owner.user.id]);
    const key = decrypt(t.config.encryptionKey, rows[0].private_key_enc) as Hex;
    await t.app.ctx.chain!.custodial(key).call('registry', 'transferFrom', [owner.user.wallets[0]!.address, friend.user.wallets[0]!.address, BigInt(ai.token.tokenId)], 'give it away');

    await indexRegistry(t.app.ctx);
    expect((await call('GET', `/ais/${ai.id}`, friend.accessToken)).statusCode).toBe(200);
    expect((await call('GET', `/ais/${ai.id}`, owner.accessToken)).statusCode).toBe(404);
  });

  it("refuses a purchase the buyer can't pay for", async () => {
    const [seller, poor] = [await signUp(t), await signUp(t)];
    const ai = await verifiedAi(seller);
    await call('PUT', `/ais/${ai.id}/market`, seller.accessToken, { sale: { price: '50' }, rent: null, ...pw(seller) });
    const res = await call('POST', `/ais/${ai.id}/market/buy`, poor.accessToken, pw(poor));
    expect(res.json().error.code).toBe('INSUFFICIENT_FUNDS');
  });
});

async function rpc(method: string, params: unknown[]) {
  const res = await fetch(inject('chain').rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  return res.json();
}
