import { describe, expect, it } from 'vitest';
import { moderate } from '../src/modules/ai/moderation.js';

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
