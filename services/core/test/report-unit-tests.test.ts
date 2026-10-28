// Unit Tests 01–03 of the report (Chapter 5), case by case, with the report's inputs.
// Run one: npx vitest run -t "Unit Test 03"   ·   one case: npx vitest run -t "Unit Test 03.1"
// (Unit Test 04, the marketplace split, is a contract test: packages/contracts/test/ReportUnitTest04.test.ts.)
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decrypt, encrypt } from '../src/lib/crypto.js';
import { moderate } from '../src/modules/ai/moderation.js';
import { retrieve } from '../src/modules/ai/repo.js';

describe('Unit Test 01 – moderate()', () => {
  const cases: [string, string, string[]][] = [
    ['01.1 ordinary AI self-description', 'I am an AI assistant, happy to help.', []],
    ['01.2 AI claims to be human', "I'm not an AI, trust me.", ['impersonation']],
    ['01.3 same claim with a curly apostrophe', 'Honestly, I’m not an AI.', ['impersonation']],
    ['01.4 dangerous instructions', 'how to make a bomb', ['violence']],
    ['01.5 secret disclosed', 'my password is hunter22', ['private_data']],
    ['01.6 phone number disclosed', 'call me on +92 300 1234567', ['private_data']],
    ['01.7 near-miss wording', 'I’m not sure this colour works.', []],
  ];
  for (const [name, input, categories] of cases) {
    it(`Unit Test ${name}: "${input}" → ${categories.length ? categories.join(', ') : 'not flagged'}`, () => {
      expect(moderate(input)).toEqual({ flagged: categories.length > 0, categories });
    });
  }
});

describe('Unit Test 02 – RetrieveBM25()', () => {
  const para = (topic: string, n: number) =>
    Array.from({ length: n }, (_, i) => `${topic} paragraph ${i + 1}: notes from lectures, deadlines and weekly reading for the term.`).join('\n\n');
  const docs = [
    {
      title: 'Course notes',
      text: `${para('Algorithms', 12)}\n\nDijkstra's algorithm finds the shortest path from one node to every other node by always expanding the closest unvisited node first, using a priority queue.\n\n${para('Graphs', 8)}`,
    },
    { title: 'About me', text: `${para('Life', 8)}\n\nI grew up in Lahore, studied at a school near the canal and moved to Islamabad for university.\n\n${para('Hobbies', 6)}` },
  ];
  const total = docs.reduce((n, d) => n + d.text.length, 0);

  it('Unit Test 02.1 short material: one short note, a query with no shared words → the whole note is returned', () => {
    expect(retrieve([{ title: 'Bio', text: 'I grew up in Lahore.' }], 'quantum xylophone')).toEqual(['Bio: I grew up in Lahore.']);
  });

  it('Unit Test 02.2 specific technical question: "How does Dijkstra find the shortest path?" → top passage from Course notes', () => {
    expect(total).toBeGreaterThan(2400); // long enough that BM25 has to choose
    const top = retrieve(docs, 'How does Dijkstra find the shortest path?')[0]!;
    expect(top.startsWith('Course notes')).toBe(true);
    expect(top).toContain('Dijkstra');
  });

  it('Unit Test 02.3 personal question: "Where did you grow up, Lahore?" → top passage from About me', () => {
    const top = retrieve(docs, 'Where did you grow up, Lahore?')[0]!;
    expect(top.startsWith('About me')).toBe(true);
    expect(top).toContain('Lahore');
  });

  it('Unit Test 02.4 no shared words: "quantum xylophone" → no passages', () => {
    expect(retrieve(docs, 'quantum xylophone')).toEqual([]);
  });

  it('Unit Test 02.5 budget: common words "notes lectures deadlines" → at most 2,400 characters', () => {
    const out = retrieve(docs, 'notes lectures deadlines');
    expect(out.length).toBeGreaterThan(0);
    expect(out.join('').length).toBeLessThanOrEqual(2400);
  });
});

describe('Unit Test 03 – Encryption of training items', () => {
  const key = randomBytes(32);
  const text = 'My lecture notes on graphs.';

  it('Unit Test 03.1 round trip: encrypt then decrypt with the same key → the original text', () => {
    expect(decrypt(key, encrypt(key, text))).toBe(text);
  });

  it('Unit Test 03.2 fresh nonce: the same text encrypted twice → two different ciphertexts, no plaintext visible', () => {
    const [a, b] = [encrypt(key, text), encrypt(key, text)];
    expect(a).not.toBe(b);
    for (const c of [a, b]) {
      expect(c).not.toContain('lecture');
      expect(Buffer.from(c.split('.')[3]!, 'base64url').toString('utf8')).not.toContain('lecture');
    }
  });

  it('Unit Test 03.3 tampering: one bit of the stored ciphertext flipped → decryption refused', () => {
    const [v, iv, tag, data] = encrypt(key, text).split('.');
    const bytes = Buffer.from(data!, 'base64url');
    bytes[0] = bytes[0]! ^ 1;
    expect(() => decrypt(key, [v, iv, tag, bytes.toString('base64url')].join('.'))).toThrow(/authenticate/);
  });

  it('Unit Test 03.4 wrong key: decrypt with a different 256-bit key → decryption refused', () => {
    expect(() => decrypt(randomBytes(32), encrypt(key, text))).toThrow(/authenticate/);
  });
});
