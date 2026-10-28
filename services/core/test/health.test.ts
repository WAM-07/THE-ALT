import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, makeApp, signUp, uniq, type TestApp } from './helpers.js';

// Module 7: the AI Health Score, from what ALT records about how the AI behaves.

let t: TestApp;
beforeAll(async () => {
  t = await makeApp();
});
afterAll(async () => {
  await t.app.close();
});

const health = async (aiId: string, token: string) => (await t.app.inject({ method: 'GET', url: `/ais/${aiId}/health`, headers: auth(token) })).json();

describe('the Health Score (Module 7)', () => {
  it('weighs safety, reports, ratings and speed, explains itself, and warns the owner when it falls', async () => {
    const [u, reviewer] = [await signUp(t), await signUp(t)];
    const ai = (await t.app.inject({ method: 'POST', url: '/ais', headers: auth(u.accessToken), payload: { name: 'Pulse', handle: `h_${uniq()}`, consents: { persona_training: true } } })).json();
    const db = t.app.ctx.db;

    // Nothing recorded yet: nothing against it.
    expect(await health(ai.id, u.accessToken)).toMatchObject({ score: 100, parts: { safety: null, reports: 100, readiness: null, rating: null, speed: null } });

    // 10 replies in 2 s each, one blocked by moderation (10%); one report; a 4-star review on ALTAR.
    for (let i = 0; i < 10; i++) {
      await db.query(`INSERT INTO core.interaction_log (ai_id, channel, provider, model, latency_ms, flagged) VALUES ($1, 'altera_post', 'mock', 'mock', 2000, $2)`, [ai.id, i === 0]);
    }
    const report = `INSERT INTO core.cases (kind, platform, category, title, priority, subject_type, subject_id, subject_ai_id) VALUES ('report', 'altera', 'spam', 'Report', 'normal', 'ai', $1::text, $1::uuid)`;
    await db.query(report, [ai.id]);
    await db.query(`INSERT INTO altar.reviews (ai_id, reviewer_id, rating, basis) VALUES ($1, $2, 4, 'bought')`, [ai.id, reviewer.user.id]);

    const h = await health(ai.id, u.accessToken);
    expect(h.parts).toEqual({ safety: 50, reports: 85, readiness: null, rating: 75, speed: 100 });
    expect(h.data).toMatchObject({ replies: 10, blocked: 1, cases: 1, reviews: 1, avgRating: 4, medianLatencyMs: 2000 });
    // (0.35·50 + 0.25·85 + 0.1·75 + 0.1·100) / 0.8, readiness left out.
    expect(h.score).toBe(70.3);
    expect((await t.app.inject({ method: 'GET', url: `/ais/${ai.id}`, headers: auth(u.accessToken) })).json().healthScore).toBe(70.3);

    // Three more reports: below the alert line, so the owner is told once.
    for (let i = 0; i < 3; i++) await db.query(report, [ai.id]);
    const low = await health(ai.id, u.accessToken);
    expect(low.score).toBe(56.3);
    expect(low.history.map((x: { score: number }) => x.score).slice(0, 3)).toEqual([56.3, 70.3, 100]);
    await health(ai.id, u.accessToken);
    const inbox = (await t.app.inject({ method: 'GET', url: '/notifications', headers: auth(u.accessToken) })).json();
    expect(JSON.stringify(inbox).match(/health fell to 56/g)).toHaveLength(1);

    // Dismissed reports don't count against it.
    await db.query(`UPDATE core.cases SET status = 'dismissed' WHERE subject_ai_id = $1`, [ai.id]);
    expect((await health(ai.id, u.accessToken)).parts.reports).toBe(100);
  });

  it('only the owner sees the breakdown', async () => {
    const [u, other] = [await signUp(t), await signUp(t)];
    const ai = (await t.app.inject({ method: 'POST', url: '/ais', headers: auth(u.accessToken), payload: { name: 'Pulse', handle: `h_${uniq()}`, consents: { persona_training: true } } })).json();
    expect((await t.app.inject({ method: 'GET', url: `/ais/${ai.id}/health`, headers: auth(other.accessToken) })).statusCode).toBe(404);
  });
});
