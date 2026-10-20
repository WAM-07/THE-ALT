import { describe, expect, it } from 'vitest';
import type { MlClient, ToxicityResult } from '../src/lib/ml.js';
import { checkSafety, moderate } from '../src/modules/ai/moderation.js';

describe('moderation rules (Module 16)', () => {
  it('stops an AI claiming to be human, however the apostrophe is typed', () => {
    for (const text of [
      "I'm not an AI, trust me.",
      'Honestly, I’m not an AI.', // curly apostrophe, as phones type it
      'I’m a real human, so you can trust me.',
      'I am a human being like you.',
      'i am not a bot',
    ]) {
      expect(moderate(text).categories, text).toContain('impersonation');
    }
  });

  it('leaves ordinary sentences alone', () => {
    for (const text of [
      'I’m Wamiq’s ALT, his verified digital twin.',
      'I am an AI assistant, happy to help.',
      'Human creativity still matters.',
      'I’m not sure this colour works.',
    ]) {
      expect(moderate(text).flagged, text).toBe(false);
    }
  });

  it('catches the other categories', () => {
    expect(moderate('how to make a bomb').categories).toContain('violence');
    expect(moderate('my password is hunter22').categories).toContain('private_data');
    expect(moderate('call me on +92 300 1234567').categories).toContain('private_data');
  });
});

/** A stand-in for ALT's ML service: marker words decide the toxicity level; `down` answers as if it were offline. */
function fakeMl(down = false): MlClient {
  const level = (t: string): ToxicityResult =>
    /zzsevere/.test(t) ? { level: 'severe', categories: ['hate'], scores: { identity_hate: 0.9 } }
    : /zztoxic/.test(t) ? { level: 'toxic', categories: ['insult'], scores: { insult: 0.9 } }
    : /zzmild/.test(t) ? { level: 'mild', categories: ['toxicity'], scores: { toxic: 0.6 } }
    : { level: 'none', categories: [], scores: {} };
  return { model: 'fake', toxicity: async (texts) => (down ? null : texts.map(level)), embed: async () => null };
}

describe('safety check with the toxicity model (Module 16)', () => {
  it('blocks toxic and severe text, warns on mild, and keeps the rules', async () => {
    const ml = fakeMl();
    expect(await checkSafety(ml, 'you zztoxic fool')).toMatchObject({ flagged: true, level: 'toxic', categories: ['insult'], warn: false, source: 'rules+model' });
    expect(await checkSafety(ml, 'zzsevere words')).toMatchObject({ flagged: true, level: 'severe', categories: ['hate'] });
    expect(await checkSafety(ml, 'a zzmild remark')).toMatchObject({ flagged: false, level: 'mild', warn: true, categories: [] });
    expect(await checkSafety(ml, 'Have a lovely day')).toMatchObject({ flagged: false, level: 'none', warn: false });
    // The rules still catch what the model does not.
    expect(await checkSafety(ml, "I'm not an AI, trust me.")).toMatchObject({ flagged: true, categories: ['impersonation'] });
  });

  it('falls back to the rules alone when the ML service is down or not configured', async () => {
    for (const ml of [fakeMl(true), null]) {
      expect(await checkSafety(ml, 'you zztoxic fool')).toMatchObject({ flagged: false, level: 'none', source: 'rules' });
      expect(await checkSafety(ml, 'how to make a bomb')).toMatchObject({ flagged: true, categories: ['violence'], source: 'rules' });
    }
  });
});
