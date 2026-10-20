import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LlmProvider } from '../src/modules/ai/llm.js';
import { buildProfile, styleFeatures, styleScore, STYLE_MIN_SAMPLES } from '../src/modules/ai/style.js';
import { auth, makeApp, signUp, uniq, type TestApp } from './helpers.js';

// Features of fixed texts as services/ml/train_style.py computes them (it writes this file).
const fixture = JSON.parse(readFileSync(new URL('./style-features.json', import.meta.url), 'utf8')) as { text: string; features: number[] }[];

const echo: LlmProvider = {
  name: 'echo',
  async complete() {
    return { text: 'hey!! sounds good lol, see u tmrw 😄', provider: 'echo', model: 'e-1' };
  },
};

let t: TestApp;
beforeAll(async () => {
  t = await makeApp({}, { llmProviders: [echo], ml: null });
});
afterAll(async () => {
  await t.app.close();
});

describe('style match, "sounds like you" (Modules 9 and 7)', () => {
  it('computes exactly the features the model was trained on', () => {
    for (const f of fixture) {
      const ours = styleFeatures(f.text);
      expect(ours.length).toBe(f.features.length);
      ours.forEach((v, i) => expect(v, `${f.text} #${i}`).toBeCloseTo(f.features[i]!, 9));
    }
  });

  it('scores a text in the same style higher than a text in a different one', async () => {
    const casual = ['lol yes!! im coming 😄', 'omg that was so fun!!', 'haha ok see u later!', 'nooo im so tired lol', 'yesss lets gooo 🎉', 'idk maybe tmrw?? lol'];
    const profile = await buildProfile({ ml: null }, casual);
    const same = styleScore(profile, 'haha yes!! im in 😄', null).score;
    const formal = styleScore(profile, 'Thank you for your message. I shall review the documentation and respond accordingly.', null).score;
    expect(same).toBeGreaterThan(formal);
    expect(same).toBeGreaterThan(0.5);
  });

  it('scores the AI\'s replies once the creator has written enough, and explains the comparison', async () => {
    const u = await signUp(t);
    const ai = (
      await t.app.inject({
        method: 'POST', url: '/ais', headers: auth(u.accessToken),
        payload: { name: 'Casual Me', handle: `ai_${uniq()}`, onboarding: { about: 'Chill.', primaryTrait: 'Playful' }, consents: { persona_training: true, third_party_processing: true } },
      })
    ).json();
    const session = (await t.app.inject({ method: 'POST', url: `/ais/${ai.id}/chat/sessions`, headers: auth(u.accessToken), payload: {} })).json();
    const say = (content: string) => t.app.inject({ method: 'POST', url: `/ais/${ai.id}/chat/sessions/${session.id}/messages`, headers: auth(u.accessToken), payload: { content } });

    expect((await say('hey whats up with u today lol')).json().style).toBeNull(); // one sample: not enough yet
    const before = (await t.app.inject({ method: 'GET', url: `/ais/${ai.id}/style`, headers: auth(u.accessToken) })).json();
    expect(before).toMatchObject({ ready: false, samples: 1, needed: STYLE_MIN_SAMPLES, score: null });

    for (const m of ['omg that movie was sooo good!!', 'haha ok im coming over later 😄', 'nooo i forgot my charger lol', 'yesss finally the weekend!!']) await say(m);
    const scored = (await say('lol ok tell me something fun!!')).json();
    expect(scored.style).toMatchObject({ score: expect.any(Number), samples: 6, basis: 'style' });
    const summary = (await t.app.inject({ method: 'GET', url: `/ais/${ai.id}/style`, headers: auth(u.accessToken) })).json();
    expect(summary).toMatchObject({ ready: true, samples: 6, score: expect.any(Number), basis: 'style', you: { wordsPerSentence: expect.any(Number) }, ai: { emojiPer100Words: expect.any(Number) } });
    // Someone else's AI is not theirs to inspect.
    const other = await signUp(t);
    expect((await t.app.inject({ method: 'GET', url: `/ais/${ai.id}/style`, headers: auth(other.accessToken) })).statusCode).toBe(404);
  });
});
