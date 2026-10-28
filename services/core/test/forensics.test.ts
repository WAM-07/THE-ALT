import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, makeApp, signUp, trainAi, uniq, type TestApp } from './helpers.js';

// Module 5 forensics: an AI's behaviour over time, for staff in the ALT Command Centre.

const bossEmail = `boss_${uniq()}@alt.test`;
let t: TestApp;
beforeAll(async () => {
  t = await makeApp({ ADMIN_EMAILS: bossEmail });
});
afterAll(async () => {
  await t.app.close();
});

describe('an AI over time (Module 5)', () => {
  it('shows staff its replies and blocks per day, health, versions, cases and audit trail; nobody else', async () => {
    const u = await signUp(t);
    const ai = (await t.app.inject({ method: 'POST', url: '/ais', headers: auth(u.accessToken), payload: { name: 'Trace', handle: `f_${uniq()}`, consents: { persona_training: true } } })).json();
    await trainAi(t, ai.id, u.accessToken);
    const db = t.app.ctx.db;
    for (const flagged of [false, true, false]) {
      await db.query(`INSERT INTO core.interaction_log (ai_id, channel, provider, model, latency_ms, flagged) VALUES ($1, 'altera_post', 'mock', 'mock', 1000, $2)`, [ai.id, flagged]);
    }
    await t.app.inject({ method: 'GET', url: `/ais/${ai.id}/health`, headers: auth(u.accessToken) });

    expect((await t.app.inject({ method: 'GET', url: `/admin/ais/${ai.id}/timeline`, headers: auth(u.accessToken) })).statusCode).toBe(403);
    const boss = await signUp(t, { email: bossEmail, platform: 'admin' });
    const found = (await t.app.inject({ method: 'GET', url: `/admin/ais?q=${ai.handle}`, headers: auth(boss.accessToken) })).json();
    expect(found).toEqual([expect.objectContaining({ id: ai.id, handle: ai.handle, owner: u.handle })]);

    const tl = (await t.app.inject({ method: 'GET', url: `/admin/ais/${ai.id}/timeline?days=7`, headers: auth(boss.accessToken) })).json();
    expect(tl.activity).toHaveLength(7);
    expect(tl.activity.at(-1)).toMatchObject({ replies: 3, blocked: 1, avgLatencyMs: 1000 });
    expect(tl.versions).toEqual([expect.objectContaining({ version: 1, engine: 'adapter', training: 'simulated' })]);
    expect(tl.health[0].parts).toMatchObject({ safety: expect.any(Number) });
    expect(tl.audit.map((e: { action: string }) => e.action)).toEqual(expect.arrayContaining(['ai.created', 'ai.training_started', 'ai.training_completed']));
  });
});
