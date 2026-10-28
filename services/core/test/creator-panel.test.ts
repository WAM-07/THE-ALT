import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, makeApp, signUp, uniq, type TestApp } from './helpers.js';

// Module 18: the Creator Control Panel, from ALTAR's earnings view, ALTERA's engagement view and Core.

let t: TestApp;
beforeAll(async () => {
  t = await makeApp();
});
afterAll(async () => {
  await t.app.close();
});

const get = (url: string, token: string) => t.app.inject({ method: 'GET', url, headers: auth(token) });
const wei = (pol: string) => (BigInt(Math.round(Number(pol) * 1e6)) * 10n ** 12n).toString();

describe('the Creator Control Panel (Module 18)', () => {
  it('adds up earnings as owner and royalties as creator, with engagement, health and versions, and exports them', async () => {
    const [alice, bob, carol] = [await signUp(t), await signUp(t), await signUp(t)];
    const db = t.app.ctx.db;
    const ai = (await t.app.inject({ method: 'POST', url: '/ais', headers: auth(alice.accessToken), payload: { name: 'Muse', handle: `m_${uniq()}`, consents: { persona_training: true } } })).json();

    // ALTAR's mirror of the contract's events: Alice sells to Bob (1 POL), Bob rents it to Carol (0.5 POL).
    const sale = `INSERT INTO altar.transactions (kind, ai_id, token_id, from_address, to_address, from_user_id, to_user_id, amount_wei, royalty_wei, royalty_user_id, fee_wei, days, chain_id, tx_hash, log_index, block_number, occurred_at)
                  VALUES ($1, $2, 1, '0x1', '0x2', $3, $4, $5, $6, $7, $8, $9, 31337, $10, 0, 1, $11)`;
    await db.query(sale, ['sale', ai.id, alice.user.id, bob.user.id, wei('1'), '0', null, wei('0.025'), null, `0x${randomBytes(32).toString('hex')}`, '2026-09-10T10:00:00Z']);
    await db.query(sale, ['rental', ai.id, bob.user.id, carol.user.id, wei('0.5'), wei('0.025'), alice.user.id, wei('0.0125'), 5, `0x${randomBytes(32).toString('hex')}`, '2026-10-02T10:00:00Z']);
    await db.query('UPDATE core.personal_ais SET owner_id = $2 WHERE id = $1', [ai.id, bob.user.id]); // the token moved to Bob

    // ALTERA: the AI's profile with a follower and a liked post.
    const profile = (await db.query(`INSERT INTO altera.ai_profiles (user_id, username, display_name, core_ai_id) VALUES ($1, $2, 'Muse', $3) RETURNING id`, [bob.user.id, `muse_${uniq()}`, ai.id])).rows[0].id;
    await db.query('INSERT INTO altera.follows (follower_id, following_id) VALUES ($1, $2)', [carol.user.id, profile]);
    const post = (await db.query(`INSERT INTO altera.posts (user_id, ai_profile_id, content) VALUES ($1, $2, 'Hello') RETURNING id`, [bob.user.id, profile])).rows[0].id;
    await db.query('INSERT INTO altera.likes (user_id, post_id) VALUES ($1, $2)', [carol.user.id, post]);

    // Alice, the creator: her sale (minus the fee) and her royalty on Bob's rental.
    const a = (await get('/me/creator-panel', alice.accessToken)).json();
    expect(a.totals).toMatchObject({ sales: { pol: '0.975' }, rentals: { pol: '0' }, royalties: { pol: '0.025' }, total: { pol: '1' }, transactions: 2 });
    expect(a.byMonth).toEqual([
      { month: '2026-09', wei: wei('0.975'), pol: '0.975' },
      { month: '2026-10', wei: wei('0.025'), pol: '0.025' },
    ]);
    expect(a.ais[0]).toMatchObject({ id: ai.id, youOwn: false, youCreated: true, healthScore: 100, engagement: { followers: 1, posts: 1, likes: 1, influence: 8 } });
    expect(a.transactions.map((x: { as: string }) => x.as)).toEqual(['creator (royalty)', 'seller']);

    // Bob, the owner now: the rental minus the royalty and the fee.
    const b = (await get('/me/creator-panel', bob.accessToken)).json();
    expect(b.totals).toMatchObject({ rentals: { pol: '0.4625' }, royalties: { pol: '0' }, total: { pol: '0.4625' } });
    expect(b.ais[0]).toMatchObject({ youOwn: true, youCreated: false });
    expect((await get('/me/creator-panel', carol.accessToken)).json()).toMatchObject({ ais: [], totals: { transactions: 0 } });

    const csv = await get('/me/creator-panel/export?format=csv', alice.accessToken);
    expect(csv.headers['content-type']).toContain('text/csv');
    const rows = csv.body.trim().split('\r\n');
    expect(rows[0]).toBe('date,kind,ai,you_earned_pol,as,total_paid_pol,days,months,tx_hash');
    expect(rows[1]).toContain('rental,Muse,0.025,creator (royalty),0.5,5');
    const pdf = await get('/me/creator-panel/export?format=pdf', alice.accessToken);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.rawPayload.subarray(0, 8).toString()).toBe('%PDF-1.4');
    // A real PDF: read it back.
    const { extractText, getDocumentProxy } = await import('unpdf');
    const { text } = await extractText(await getDocumentProxy(new Uint8Array(pdf.rawPayload)), { mergePages: true });
    expect(text).toContain('Total earned: 1 POL (2 transactions)');
    expect(text).toContain('Muse');
  });
});
