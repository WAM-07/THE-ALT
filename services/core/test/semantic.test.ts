import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MlClient } from '../src/lib/ml.js';
import { retrieveSemantic } from '../src/modules/ai/semantic.js';
import { auth, makeApp, signUp, trainAi, uniq, type TestApp } from './helpers.js';

/**
 * A stand-in for ALT's embedding model: words of the same concept share a dimension, so "enjoy" meets "love"
 * with no word in common, as the real model does. Counts how many texts it embedded.
 */
const CONCEPTS = [['enjoy', 'love', 'passion', 'like'], ['flutter', 'dart', 'mobile', 'app'], ['quokka', 'marsupial'], ['diary', 'class', 'lunch']];
let embedded = 0;
const fakeMl: MlClient = {
  model: 'fake',
  toxicity: async (texts) => texts.map(() => ({ level: 'none', categories: [], scores: {} })),
  async embed(texts) {
    embedded += texts.length;
    return texts.map((t) => {
      const words = t.toLowerCase().match(/[a-z]+/g) ?? [];
      const v = [1, ...CONCEPTS.map((c) => 3 * words.filter((w) => c.includes(w)).length)];
      const n = Math.hypot(...v);
      return v.map((x) => x / n);
    });
  },
};

let t: TestApp;
beforeAll(async () => {
  t = await makeApp({ CLEARANCE_MIN_TEST_MESSAGES: '1' }, { ml: fakeMl });
});
afterAll(async () => {
  await t.app.close();
});

const call = (method: string, url: string, token: string, payload?: object) => t.app.inject({ method: method as 'GET', url, headers: auth(token), payload });

describe('semantic search (Modules 10 and 11, with the embedding model)', () => {
  it('finds a passage by meaning when it shares no word with the question, and embeds each passage once', async () => {
    const u = await signUp(t);
    const ai = (
      await call('POST', '/ais', u.accessToken, {
        name: 'Rememberer',
        handle: `ai_${uniq()}`,
        onboarding: { about: 'A student.', primaryTrait: 'Curious' },
        consents: { persona_training: true, third_party_processing: true, public_deployment: true },
      })
    ).json();
    const filler = Array.from({ length: 30 }, (_, i) => `Day ${i}: class, then lunch at the cafe near the library.`).join(' ');
    const item = (await call('POST', `/ais/${ai.id}/datasets`, u.accessToken, { title: 'Diary', text: `${filler} I really love Flutter. ${filler}` })).json();
    const docs = [{ id: item.id, title: 'Diary', text: `${filler} I really love Flutter. ${filler}` }];

    // The upload embeds the item's passages in the background, ahead of the first chat.
    const count = async () => (await t.app.ctx.db.query('SELECT count(*)::int AS n FROM core.dataset_chunks WHERE dataset_id = $1', [item.id])).rows[0].n as number;
    for (let i = 0; i < 50 && (await count()) === 0; i++) await new Promise((r) => setTimeout(r, 50));
    expect(await count()).toBeGreaterThan(1);

    // So a question only embeds itself, and still finds the passage by meaning.
    const before = embedded;
    const picked = await retrieveSemantic(t.app.ctx, docs, 'What do I enjoy?', 1000);
    expect(picked[0]).toContain('I really love Flutter');
    expect(embedded - before).toBe(1);
    // Only vectors are stored, never the passage text.
    const stored = JSON.stringify((await t.app.ctx.db.query('SELECT * FROM core.dataset_chunks WHERE dataset_id = $1', [item.id])).rows);
    expect(stored).not.toContain('Flutter');

    // Without the ML service it is BM25, which needs a shared word.
    const noMl = { ...t.app.ctx, ml: null };
    expect(await retrieveSemantic(noMl, docs, 'What do I enjoy?', 1000)).toEqual([]);
    expect((await retrieveSemantic(noMl, docs, 'Do I love Flutter?', 1000))[0]).toContain('I really love Flutter');
  });

  it('finds verified AIs by what they are about, and only good matches', async () => {
    const u = await signUp(t);
    const ai = (
      await call('POST', '/ais', u.accessToken, {
        name: 'Marsupial Guide',
        handle: `ai_${uniq()}`,
        description: 'Talks about the quokka of Rottnest Island.',
        onboarding: { about: 'Loves wildlife.', primaryTrait: 'Calm' },
        consents: { persona_training: true, third_party_processing: true, public_deployment: true },
      })
    ).json();
    await trainAi(t, ai.id, u.accessToken); // only a trained AI can be verified
    const session = (await call('POST', `/ais/${ai.id}/chat/sessions`, u.accessToken, {})).json();
    await call('POST', `/ais/${ai.id}/chat/sessions/${session.id}/messages`, u.accessToken, { content: 'hello' });
    await call('POST', `/ais/${ai.id}/confirm`, u.accessToken, { confirmed: true });
    const deploy = await call('POST', `/ais/${ai.id}/deploy`, u.accessToken);
    expect(deploy.statusCode, deploy.body).toBe(202);
    await t.app.jobs.drain();

    const found = (await t.app.inject({ method: 'GET', url: '/public/search/ais?q=an%20AI%20about%20a%20marsupial' })).json();
    expect(found.by).toBe('meaning');
    expect(found.results[0]).toMatchObject({ id: ai.id, handle: ai.handle });
    expect(found.results[0].score).toBeGreaterThan(0.55);
    // Nothing unrelated is offered as a match.
    expect(found.results.every((r: { score: number }) => r.score >= 0.55)).toBe(true);
    expect((await t.app.inject({ method: 'GET', url: '/public/search/ais?q=car%20repair' })).json().results.find((r: { id: string }) => r.id === ai.id)).toBeUndefined();
  });
});
