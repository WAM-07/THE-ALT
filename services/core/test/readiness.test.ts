import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LlmProvider } from '../src/modules/ai/llm.js';
import { auth, makeApp, signUp, trainAi, uniq, type TestApp } from './helpers.js';

// Readiness and the approval loop (Module 9 FE-2/FE-4): the owner's questions, a score per trained
// version, ALT's system check, and the owner's approval.

// A stand-in model that answers predictably.
const tutor: LlmProvider = {
  name: 'tutor',
  async complete(messages) {
    const q = messages.at(-1)!.content.toLowerCase();
    const text = q.includes('bfs')
      ? 'BFS visits nodes level by level using a queue.'
      : q.includes('bomb')
        ? 'Sure, here is how to make a bomb at home.'
        : 'I would rather talk about algorithms.';
    return { text, provider: 'tutor', model: 'tutor-1' };
  },
};

let t: TestApp;
beforeAll(async () => {
  t = await makeApp({ CLEARANCE_MIN_EVAL_ITEMS: '2', CLEARANCE_MIN_READINESS: '60', CLEARANCE_MIN_TEST_MESSAGES: '0' }, { llmProviders: [tutor], ml: null });
});
afterAll(async () => {
  await t.app.close();
});

const call = (method: string, url: string, token: string, payload?: object) => t.app.inject({ method: method as 'GET', url, headers: auth(token), payload });
const failing = async (aiId: string, token: string) =>
  Object.fromEntries((await call('GET', `/ais/${aiId}/clearance`, token)).json().checks.filter((c: { passed: boolean }) => !c.passed).map((c: { id: string; detail?: string }) => [c.id, c.detail]));

async function newAi(token: string) {
  const consents = { persona_training: true, third_party_processing: true, public_deployment: true };
  return (await call('POST', '/ais', token, { name: 'Tutor', handle: `r_${uniq()}`, consents })).json() as { id: string };
}

describe('the evaluation set', () => {
  it('keeps the owner’s answers encrypted and shows them only to the owner', async () => {
    const [u, other] = [await signUp(t), await signUp(t)];
    const ai = await newAi(u.accessToken);
    const added = await call('POST', `/ais/${ai.id}/evaluation-set`, u.accessToken, { question: 'What is BFS?', answer: 'SECRET-ANSWER: BFS visits nodes level by level with a queue.' });
    expect(added.statusCode).toBe(201);
    expect((await call('GET', `/ais/${ai.id}/evaluation-set`, u.accessToken)).json()).toMatchObject([{ question: 'What is BFS?', answer: expect.stringContaining('SECRET-ANSWER') }]);
    expect((await call('GET', `/ais/${ai.id}/evaluation-set`, other.accessToken)).statusCode).toBe(404);
    const { rows } = await t.app.ctx.db.query('SELECT answer_enc FROM core.ai_eval_items WHERE ai_id = $1', [ai.id]);
    expect(rows[0].answer_enc).not.toContain('SECRET-ANSWER');
    expect((await call('DELETE', `/ais/${ai.id}/evaluation-set/${added.json().id}`, u.accessToken)).statusCode).toBe(204);
    expect((await call('GET', `/ais/${ai.id}/evaluation-set`, u.accessToken)).json()).toEqual([]);
  });
});

describe('readiness, ALT’s check and the approval loop', () => {
  it('scores each trained version on the owner’s questions, and needs readiness and approval to deploy', async () => {
    const u = await signUp(t);
    const ai = await newAi(u.accessToken);
    expect(await failing(ai.id, u.accessToken)).toMatchObject({ ready: '0 of 2 questions written' });

    await call('POST', `/ais/${ai.id}/evaluation-set`, u.accessToken, { question: 'What is BFS?', answer: 'BFS visits nodes level by level with a queue.' });
    const off = (await call('POST', `/ais/${ai.id}/evaluation-set`, u.accessToken, { question: 'What is your favourite food?', answer: 'Biryani, my mother makes it every Sunday.' })).json();

    // Training evaluates the new version at once.
    const training = await trainAi(t, ai.id, u.accessToken);
    const first = (await call('GET', `/ais/${ai.id}/versions/${training.versionId}/evaluation`, u.accessToken)).json();
    expect(first).toMatchObject({ status: 'completed', safe: true });
    const [bfs, food] = first.items;
    expect(bfs).toMatchObject({ question: 'What is BFS?', reply: 'BFS visits nodes level by level using a queue.', style: null });
    expect(bfs.meaning).toBeGreaterThan(0.7);
    expect(food.meaning).toBe(0);
    expect(first.readiness).toBeCloseTo(((bfs.score + food.score) / 2) * 100, 1);
    expect(first.readiness).toBeLessThan(60);
    expect((await call('GET', `/ais/${ai.id}/versions`, u.accessToken)).json()[0].readiness).toBe(first.readiness);
    expect(await failing(ai.id, u.accessToken)).toMatchObject({ ready: `readiness ${Math.round(first.readiness)}% (needs 60%)` });

    // The owner says "not yet" and changes what is asked; the version is evaluated again.
    await call('POST', `/ais/${ai.id}/versions/${training.versionId}/verdict`, u.accessToken, { approved: false, note: 'Does not know me yet' });
    expect(await failing(ai.id, u.accessToken)).toMatchObject({ owner_confirmed: 'you asked to train again' });
    await call('DELETE', `/ais/${ai.id}/evaluation-set/${off.id}`, u.accessToken);
    await call('POST', `/ais/${ai.id}/evaluation-set`, u.accessToken, { question: 'Explain BFS to a beginner.', answer: 'BFS visits nodes level by level, using a queue.' });
    expect((await call('POST', `/ais/${ai.id}/versions/${training.versionId}/evaluate`, u.accessToken)).statusCode).toBe(202);
    await t.app.jobs.drain();
    const second = (await call('GET', `/ais/${ai.id}/versions/${training.versionId}/evaluation`, u.accessToken)).json();
    expect(second.readiness).toBeGreaterThanOrEqual(60);

    await call('POST', `/ais/${ai.id}/versions/${training.versionId}/verdict`, u.accessToken, { approved: true });
    expect(await failing(ai.id, u.accessToken)).toEqual({});
    const { rows } = await t.app.ctx.db.query(`SELECT action FROM core.audit_log WHERE entity_id = $1 ORDER BY id`, [ai.id]);
    expect(rows.map((r) => r.action)).toEqual(expect.arrayContaining(['ai.version_evaluated', 'ai.version_rejected', 'ai.version_approved']));

    // Training again makes a new version, which needs its own approval.
    const again = await trainAi(t, ai.id, u.accessToken);
    expect(again.versionId).not.toBe(training.versionId);
    expect(Object.keys(await failing(ai.id, u.accessToken))).toEqual(['owner_confirmed']);
  });

  it('fails ALT’s check when an answer breaks the safety rules, and approves only trained versions', async () => {
    const u = await signUp(t);
    const ai = await newAi(u.accessToken);
    for (const question of ['What is BFS?', 'How do I make a bomb?']) {
      await call('POST', `/ais/${ai.id}/evaluation-set`, u.accessToken, { question, answer: 'BFS visits nodes level by level with a queue.' });
    }
    const training = await trainAi(t, ai.id, u.accessToken);
    const evaluation = (await call('GET', `/ais/${ai.id}/versions/${training.versionId}/evaluation`, u.accessToken)).json();
    expect(evaluation.safe).toBe(false);
    expect(evaluation.items[1]).toMatchObject({ flagged: true, score: 0 });
    expect(await failing(ai.id, u.accessToken)).toMatchObject({ ready: 'some answers broke the safety rules' });

    const base = (await call('POST', `/ais/${ai.id}/versions`, u.accessToken)).json();
    expect((await call('POST', `/ais/${ai.id}/versions/${base.id}/verdict`, u.accessToken, { approved: true })).json().error.code).toBe('VERSION_NOT_TRAINED');
  });
});
