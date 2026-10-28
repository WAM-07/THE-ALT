import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, makeApp, signUp, trainAi, uniq, type TestApp } from './helpers.js';

// Module 3: staff review an AI in the ALT Command Centre before it is minted (DEPLOY_REVIEW=true).

const bossEmail = `boss_${uniq()}@alt.test`;
let t: TestApp;
let boss: Awaited<ReturnType<typeof signUp>>;
beforeAll(async () => {
  t = await makeApp({ ADMIN_EMAILS: bossEmail, DEPLOY_REVIEW: 'true', CLEARANCE_MIN_TEST_MESSAGES: '0' });
  boss = await signUp(t, { email: bossEmail, platform: 'admin' });
});
afterAll(async () => {
  await t.app.close();
});

const call = (method: string, url: string, token: string, payload?: object) => t.app.inject({ method: method as 'GET', url, headers: auth(token), payload });

async function readyAi(token: string) {
  const consents = { persona_training: true, third_party_processing: true, public_deployment: true };
  const ai = (await call('POST', '/ais', token, { name: 'Reviewed', handle: `r_${uniq()}`, consents })).json();
  await trainAi(t, ai.id, token);
  await call('POST', `/ais/${ai.id}/confirm`, token, { confirmed: true });
  return ai as { id: string; name: string };
}

const reviewCase = async (aiId: string) =>
  (await t.app.ctx.db.query(`SELECT id, number, status FROM core.cases WHERE kind = 'review' AND subject_ai_id = $1 ORDER BY created_at DESC LIMIT 1`, [aiId])).rows[0];

describe('review before minting (Module 3)', () => {
  it('asks staff first; approving starts the mint and tells the owner', async () => {
    const u = await signUp(t);
    const ai = await readyAi(u.accessToken);
    const deploy = await call('POST', `/ais/${ai.id}/deploy`, u.accessToken);
    expect(deploy.statusCode).toBe(202);
    expect(deploy.json()).toMatchObject({ status: 'in_review', review: { caseNumber: expect.any(Number) } });
    expect((await call('GET', `/ais/${ai.id}`, u.accessToken)).json().status).toBe('ready'); // nothing minted yet
    expect((await call('POST', `/ais/${ai.id}/deploy`, u.accessToken)).json().error.code).toBe('REVIEW_PENDING');

    const c = await reviewCase(ai.id);
    const view = (await call('GET', `/staff/cases/${c.id}`, boss.accessToken)).json();
    expect(view.targets.review).toMatchObject({ version: 1 });
    // The owner can't approve their own AI.
    expect((await call('POST', `/staff/cases/${c.id}/actions`, u.accessToken, { action: 'approve_deploy', reason: 'Looks fine to me' })).statusCode).toBe(403);

    const ok = await call('POST', `/staff/cases/${c.id}/actions`, boss.accessToken, { action: 'approve_deploy', reason: 'Persona and answers look safe.' });
    expect(ok.statusCode).toBe(200);
    expect((await reviewCase(ai.id)).status).toBe('resolved');
    expect((await call('GET', `/ais/${ai.id}`, u.accessToken)).json().status).toBe('minting');
    await t.app.jobs.drain();
    expect((await call('GET', `/ais/${ai.id}`, u.accessToken)).json()).toMatchObject({ status: 'verified', verified: true });
    const inbox = (await call('GET', '/notifications', u.accessToken)).json().items;
    expect(inbox.some((n: { type: string }) => n.type === 'ai.review_approved')).toBe(true);
  });

  it('rejecting tells the owner why and mints nothing; they can ask again', async () => {
    const u = await signUp(t);
    const ai = await readyAi(u.accessToken);
    await call('POST', `/ais/${ai.id}/deploy`, u.accessToken);
    const c = await reviewCase(ai.id);
    await call('POST', `/staff/cases/${c.id}/actions`, boss.accessToken, { action: 'reject_deploy', reason: 'Its persona claims to be a doctor.' });
    expect((await reviewCase(ai.id)).status).toBe('dismissed');
    expect((await call('GET', `/ais/${ai.id}`, u.accessToken)).json().status).toBe('ready');
    const note = (await call('GET', '/notifications', u.accessToken)).json().items.find((n: { type: string }) => n.type === 'ai.review_rejected');
    expect(note.body).toContain('claims to be a doctor');
    // A closed review can't be approved later, and the owner can ask again.
    expect((await call('POST', `/staff/cases/${c.id}/actions`, boss.accessToken, { action: 'approve_deploy', reason: 'Changed my mind' })).json().error.code).toBe('NOT_A_REVIEW');
    expect((await call('POST', `/ais/${ai.id}/deploy`, u.accessToken)).json().status).toBe('in_review');
  });
});
