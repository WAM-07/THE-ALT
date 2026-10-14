import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LlmMessage, LlmProvider } from '../src/modules/ai/llm.js';
import { chunk, retrieve, terms } from '../src/modules/ai/repo.js';
import { auth, makeApp, signUp, uniq, type TestApp } from './helpers.js';

/** Records every prompt so the test can check what the AI was (and was not) given. */
const calls: LlmMessage[][] = [];
const spy: LlmProvider = {
  name: 'spy',
  async complete(messages) {
    calls.push(messages);
    return { text: 'spy reply', provider: 'spy', model: 'spy-1' };
  },
};
const lastSystemPrompt = () => calls[calls.length - 1]![0]!.content;

let t: TestApp;
beforeAll(async () => {
  t = await makeApp({}, { llmProviders: [spy] });
});
afterAll(async () => {
  await t.app.close();
});

const call = (method: string, url: string, token: string, payload?: object) => t.app.inject({ method: method as 'GET', url, headers: auth(token), payload });

/** A one-page PDF with a line of text (Helvetica), enough for a text extractor. */
function makePdf(text: string) {
  const stream = `BT /F1 14 Tf 72 720 Td (${text.replace(/[()\\]/g, '\\$&')}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

describe('training on documents', () => {
  it('reads uploaded PDFs, and never feeds images or other bytes to the AI', async () => {
    const u = await signUp(t);
    const ai = (
      await call('POST', '/ais', u.accessToken, {
        name: 'Reader',
        handle: `ai_${uniq()}`,
        onboarding: { about: 'A student.', primaryTrait: 'Curious' },
        consents: { persona_training: true, third_party_processing: true, public_deployment: true, interaction_learning: true },
      })
    ).json();
    const upload = (name: string, type: string, bytes: Buffer) => {
      const boundary = `b${uniq()}`;
      const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`);
      return t.app.inject({
        method: 'POST',
        url: `/ais/${ai.id}/datasets/upload`,
        headers: { ...auth(u.accessToken), 'content-type': `multipart/form-data; boundary=${boundary}` },
        payload: Buffer.concat([head, bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]),
      });
    };

    const pdf = await upload('notes.pdf', 'application/pdf', makePdf('My thesis is about pineapple farming in Murree.'));
    expect(pdf.statusCode).toBe(201);
    expect(pdf.json()).toMatchObject({ kind: 'document', usableAsText: true });
    // The owner can read back what the AI reads from it.
    const read = await t.app.inject({ method: 'GET', url: `/ais/${ai.id}/datasets/${pdf.json().id}/content?as=text`, headers: auth(u.accessToken) });
    expect(read.body).toContain('pineapple farming in Murree');
    const png = await upload('photo.png', 'image/png', Buffer.from('89504e470d0a1a0a0000000d4948445200', 'hex'));
    expect(png.json()).toMatchObject({ kind: 'image', usableAsText: false });

    // Building a version marks every included item processed; still only real text is read.
    await call('POST', `/ais/${ai.id}/versions`, u.accessToken);
    const session = (await call('POST', `/ais/${ai.id}/chat/sessions`, u.accessToken, {})).json();
    await call('POST', `/ais/${ai.id}/chat/sessions/${session.id}/messages`, u.accessToken, { content: 'What is my thesis about?' });
    const prompt = lastSystemPrompt();
    expect(prompt).toContain('pineapple farming in Murree');
    expect(prompt).not.toContain('PNG');
    expect(prompt).not.toContain('IHDR');
  });
});

describe('finding the right passages (BM25 retrieval)', () => {
  it('ranks the passage with the rare, specific words first, and meets word forms', () => {
    expect(terms('Studying studies the studied')).toEqual(['study', 'study', 'studi']);
    const filler = Array.from({ length: 40 }, (_, i) => `Day ${i}: I went to class and then I had lunch with friends at the cafe near the library.`).join(' ');
    const docs = [
      { title: 'Diary', text: filler },
      { title: 'Projects', text: `${filler} My final year project is a blockchain identity token for personal AIs. ${filler}` },
    ];
    expect(retrieve(docs, 'What is my final year project about?', 700)[0]).toContain('blockchain identity token');
    expect(chunk('One sentence here. '.repeat(80), 200).every((c) => c.length <= 320)).toBe(true);
  });

  it('sends everything when it is short, so questions with no shared words still find it', () => {
    expect(retrieve([{ title: 'Me', text: 'I love Flutter.' }], 'What do I enjoy?')).toEqual(['Me: I love Flutter.']);
  });
});
