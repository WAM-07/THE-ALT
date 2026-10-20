import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseEther, type Hex } from 'viem';
import { decrypt } from '../src/lib/crypto.js';
import type { LlmProvider } from '../src/modules/ai/llm.js';
import { auth, makeApp, signUp, uniq, type TestApp } from './helpers.js';

const echo: LlmProvider = {
  name: 'echo',
  async complete(messages) {
    return { text: `ok: ${messages[messages.length - 1]!.content.slice(0, 20)}`, provider: 'echo', model: 'echo-1' };
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

/** Builds, tests and mints an AI the way ALTER does; returns it verified. */
async function verifiedAi(token: string) {
  const ai = (
    await call('POST', '/ais', token, {
      name: 'Seller AI',
      handle: `ai_${uniq()}`,
      onboarding: { about: 'Sells well.', primaryTrait: 'Calm' },
      consents: { persona_training: true, third_party_processing: true, public_deployment: true },
    })
  ).json();
  await call('POST', `/ais/${ai.id}/versions`, token);
  const session = (await call('POST', `/ais/${ai.id}/chat/sessions`, token, {})).json();
  await call('POST', `/ais/${ai.id}/chat/sessions/${session.id}/messages`, token, { content: 'hello' });
  await call('POST', `/ais/${ai.id}/confirm`, token, { confirmed: true });
  expect((await call('POST', `/ais/${ai.id}/deploy`, token)).statusCode).toBe(202);
  await t.app.jobs.drain();
  return (await call('GET', `/ais/${ai.id}`, token)).json();
}

async function custodialKey(userId: string) {
  const { rows } = await t.app.ctx.db.query(`SELECT private_key_enc FROM core.wallets WHERE user_id = $1 AND kind = 'custodial'`, [userId]);
  return decrypt(t.config.encryptionKey, rows[0].private_key_enc) as Hex;
}

describe('the ALT wallet', () => {
  it('shows the balance, hands out test POL on the local chain, and lists owned tokens', async () => {
    const u = await signUp(t);
    const before = (await call('GET', '/me/wallet', u.accessToken)).json();
    expect(before).toMatchObject({ symbol: 'POL', balance: { wei: '0' }, earnings: { wei: '0' }, testFunds: { pol: '100' }, tokens: [] });
    expect(before.address).toBe(u.user.wallets[0]!.address);

    const funded = await call('POST', '/me/wallet/test-funds', u.accessToken);
    expect(funded.statusCode).toBe(200);
    expect(funded.json().balance.pol).toBe('100');
  });

  it('sends POL out only after the person confirms with their password', async () => {
    const u = await signUp(t);
    await call('POST', '/me/wallet/test-funds', u.accessToken);
    const to = '0x000000000000000000000000000000000000dEaD';
    expect((await call('POST', '/me/wallet/send', u.accessToken, { to, amount: '1', confirm: {} })).json().error.code).toBe('CONFIRMATION_FAILED');
    expect((await call('POST', '/me/wallet/send', u.accessToken, { to, amount: '1', confirm: { password: 'wrong one 1' } })).json().error.code).toBe('CONFIRMATION_FAILED');
    expect((await call('POST', '/me/wallet/send', u.accessToken, { to, amount: '1000', confirm: { password: u.password } })).json().error.code).toBe('INSUFFICIENT_FUNDS');
    expect((await call('POST', '/me/wallet/send', u.accessToken, { to: 'not-an-address', amount: '1', confirm: { password: u.password } })).statusCode).toBe(400);

    const sent = await call('POST', '/me/wallet/send', u.accessToken, { to, amount: '2.5', confirm: { password: u.password } });
    expect(sent.statusCode).toBe(200);
    expect(Number(sent.json().balance.pol)).toBeLessThan(97.5);
    expect(await t.app.ctx.chain!.balanceOf(to)).toBeGreaterThanOrEqual(parseEther('2.5'));
  });
});

describe('listing an AI on ALTAR', () => {
  it('lists for sale and rent from an empty wallet (ALT pays the network fee), then pays out after a sale', async () => {
    const seller = await signUp(t);
    const ai = await verifiedAi(seller.accessToken);
    expect((await call('GET', '/me/wallet', seller.accessToken)).json().tokens).toEqual([expect.objectContaining({ aiId: ai.id, tokenId: ai.token.tokenId })]);
    expect(await t.app.ctx.chain!.balanceOf(seller.user.wallets[0]!.address)).toBe(0n);

    const body = { sale: { price: '10' }, rent: { pricePerDay: '0.5', maxDays: 7 } };
    expect((await call('PUT', `/ais/${ai.id}/market`, seller.accessToken, { ...body, confirm: { password: 'nope nope 1' } })).statusCode).toBe(401);
    const listed = await call('PUT', `/ais/${ai.id}/market`, seller.accessToken, { ...body, confirm: { password: seller.password } });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toMatchObject({ sale: { price: { pol: '10' } }, rent: { pricePerDay: { pol: '0.5' }, maxDays: 7 }, platformFeeBps: expect.any(Number) });
    expect(listed.json().txs.map((x: { action: string }) => x.action)).toEqual(['approve', 'list_for_sale', 'list_for_rent']);
    // The same terms again change nothing on-chain.
    expect((await call('PUT', `/ais/${ai.id}/market`, seller.accessToken, { ...body, confirm: { password: seller.password } })).json().txs).toEqual([]);

    // Strangers can't list someone else's AI, and drafts can't be listed.
    const stranger = await signUp(t);
    expect((await call('PUT', `/ais/${ai.id}/market`, stranger.accessToken, { ...body, confirm: { password: stranger.password } })).statusCode).toBe(404);
    const draft = (await call('POST', '/ais', seller.accessToken, { name: 'Draft', handle: `ai_${uniq()}`, consents: {} })).json();
    expect((await call('PUT', `/ais/${draft.id}/market`, seller.accessToken, { ...body, confirm: { password: seller.password } })).json().error.code).toBe('AI_NOT_VERIFIED');

    // A buyer buys it on-chain (buying through ALTAR is the next step); the seller's share waits as earnings.
    const buyer = await signUp(t);
    await call('POST', '/me/wallet/test-funds', buyer.accessToken);
    await t.app.ctx.chain!.custodial(await custodialKey(buyer.user.id)).call('market', 'buy', [BigInt(ai.token.tokenId)], 'buy', parseEther('10'));

    const wallet = (await call('GET', '/me/wallet', seller.accessToken)).json();
    const fee = (10 * wallet.platformFeeBps) / 10_000;
    // The creator is the seller, so no royalty on this first sale: everything but the platform fee.
    expect(Number(wallet.earnings.pol)).toBeCloseTo(10 - fee);
    expect((await call('GET', `/ais/${ai.id}/market`, seller.accessToken)).json().sale).toBeNull();

    const out = await call('POST', '/me/wallet/withdraw', seller.accessToken, { confirm: { password: seller.password } });
    expect(out.statusCode).toBe(200);
    expect(Number(out.json().amount.pol)).toBeCloseTo(10 - fee);
    expect((await call('GET', '/me/wallet', seller.accessToken)).json().earnings.wei).toBe('0');
    expect((await call('POST', '/me/wallet/withdraw', seller.accessToken, { confirm: { password: seller.password } })).json().error.code).toBe('NOTHING_TO_WITHDRAW');

    const inbox = (await call('GET', '/notifications', seller.accessToken)).json();
    expect(JSON.stringify(inbox)).toContain('is listed');
  });
});

describe('starter test POL (beta)', () => {
  it('gives every new account its starter test POL once, with an inbox notice and an audit entry', async () => {
    const beta = await makeApp({ STARTER_TEST_POL: '100' });
    try {
      const get = (url: string, token: string) => beta.app.inject({ method: 'GET', url, headers: auth(token) });
      const u = await signUp(beta);
      expect((await get('/me/wallet', u.accessToken)).json().balance.wei).toBe('0'); // sent by the job worker
      await beta.app.jobs.drain();
      expect((await get('/me/wallet', u.accessToken)).json().balance.pol).toBe('100');
      expect(JSON.stringify((await get('/notifications', u.accessToken)).json())).toContain('100 test POL added to your ALT wallet');
      const { rows } = await beta.app.ctx.db.query(`SELECT data FROM core.audit_log WHERE action = 'wallet.starter_funds' AND entity_id = $1`, [u.user.id]);
      expect(rows).toHaveLength(1);
      await beta.app.jobs.drain(); // nothing left to send
      expect((await get('/me/wallet', u.accessToken)).json().balance.pol).toBe('100');
    } finally {
      await beta.app.close();
    }
  });

  it('gives nothing when it is not configured', async () => {
    const u = await signUp(t);
    await t.app.jobs.drain();
    expect((await call('GET', '/me/wallet', u.accessToken)).json().balance.wei).toBe('0');
  });
});
