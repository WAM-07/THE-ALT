import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LlmMessage, LlmProvider } from '../src/modules/ai/llm.js';
import { auth, makeApp, signUp, uniq, type TestApp } from './helpers.js';

/** Records every prompt so tests can check exactly what the AI was (and was not) given. */
const calls: LlmMessage[][] = [];
const spy: LlmProvider = {
  name: 'spy',
  async complete(messages) {
    calls.push(messages);
    const last = messages[messages.length - 1]!.content;
    return { text: `spy reply to: ${last.slice(0, 40)}`, provider: 'spy', model: 'spy-1', tokensIn: 10, tokensOut: 5 };
  },
};
const lastSystemPrompt = () => calls[calls.length - 1]![0]!.content;

let t: TestApp;
beforeAll(async () => {
  t = await makeApp({ CLEARANCE_MIN_TEST_MESSAGES: '3' }, { llmProviders: [spy] });
});
afterAll(async () => {
  await t.app.close();
});

const ALL_CONSENTS = { persona_training: true, third_party_processing: true, public_deployment: true, interaction_learning: true };

async function call(method: string, url: string, token: string, payload?: object) {
  return t.app.inject({ method: method as 'GET', url, headers: auth(token), payload });
}

async function createAi(token: string, consents: Record<string, boolean> = ALL_CONSENTS) {
  const handle = `ai_${uniq()}`;
  const res = await call('POST', '/ais', token, {
    name: 'Wamiq AI',
    handle,
    description: 'Thinks like Wamiq',
    onboarding: { about: 'A CS student who builds things.', pronouns: 'He/Him', age: 22, roles: ['Developer', 'Student'], primaryTrait: 'Logical' },
    consents,
  });
  expect(res.statusCode).toBe(201);
  return res.json();
}

describe('creating an AI from ALTER onboarding', () => {
  it('stores the persona and the consents, and makes the person a creator', async () => {
    const u = await signUp(t);
    const ai = await createAi(u.accessToken, { persona_training: true, third_party_processing: false });
    expect(ai).toMatchObject({ status: 'draft', verified: false, persona: { traits: ['Logical'], identity: { pronouns: 'He/Him', roles: ['Developer', 'Student'] } } });
    expect(ai.persona.style.strictness).toBeGreaterThanOrEqual(0.7);
    expect(ai.consents.persona_training.granted).toBe(true);
    expect(ai.consents.third_party_processing.granted).toBe(false);
    expect((await call('GET', '/me', u.accessToken)).json().roles).toContain('creator');
  });

  it('keeps AI handles unique across people and AIs', async () => {
    const u = await signUp(t);
    const res = await call('POST', '/ais', u.accessToken, { name: 'X', handle: u.handle, consents: {} });
    expect(res.json().error.code).toBe('HANDLE_TAKEN');
  });

  it('is private to its owner', async () => {
    const owner = await signUp(t);
    const other = await signUp(t);
    const ai = await createAi(owner.accessToken);
    expect((await call('GET', `/ais/${ai.id}`, other.accessToken)).statusCode).toBe(404);
  });
});

describe('consent engine and datasets (Module 8)', () => {
  it('refuses data without consent, and records every consent change', async () => {
    const u = await signUp(t);
    const ai = await createAi(u.accessToken, {});
    const blocked = await call('POST', `/ais/${ai.id}/datasets`, u.accessToken, { title: 'Bio', text: 'I like chess.' });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error).toMatchObject({ code: 'CONSENT_REQUIRED', details: { scope: 'persona_training' } });

    const granted = await call('PUT', `/ais/${ai.id}/consents/persona_training`, u.accessToken, { granted: true });
    expect(granted.json()).toMatchObject({ scope: 'persona_training', granted: true, policyVersion: expect.any(String) });
    expect((await call('POST', `/ais/${ai.id}/datasets`, u.accessToken, { title: 'Bio', text: 'I like chess.' })).statusCode).toBe(201);
    const list = (await call('GET', `/ais/${ai.id}/consents`, u.accessToken)).json();
    expect(list.find((c: { scope: string }) => c.scope === 'persona_training').text).toMatch(/build my personal AI/);
  });

  it('lets the owner inspect, exclude, re-include and delete each item', async () => {
    const u = await signUp(t);
    const ai = await createAi(u.accessToken);
    const item = (await call('POST', `/ais/${ai.id}/datasets`, u.accessToken, { title: 'Notes', text: 'My favourite language is Dart.', category: 'preferences' })).json();
    expect(item).toMatchObject({ kind: 'text', included: true, processed: true, category: 'preferences' });
    expect(item.sha256).toMatch(/^[0-9a-f]{64}$/);

    const content = await call('GET', `/ais/${ai.id}/datasets/${item.id}/content`, u.accessToken);
    expect(content.body).toBe('My favourite language is Dart.');

    expect((await call('PATCH', `/ais/${ai.id}/datasets/${item.id}`, u.accessToken, { included: false })).json().included).toBe(false);
    expect((await call('DELETE', `/ais/${ai.id}/datasets/${item.id}`, u.accessToken)).statusCode).toBe(200);
    expect((await call('GET', `/ais/${ai.id}/datasets`, u.accessToken)).json()).toHaveLength(0);
    expect((await call('GET', `/ais/${ai.id}/datasets/${item.id}/content`, u.accessToken)).statusCode).toBe(404);
  });

  it('accepts file uploads and only reads text files for now', async () => {
    const u = await signUp(t);
    const ai = await createAi(u.accessToken);
    const boundary = '----alt';
    const body =
      `--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\nMy essay\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="essay.txt"\r\nContent-Type: text/plain\r\n\r\nEssay about robots.\r\n--${boundary}--\r\n`;
    const res = await t.app.inject({
      method: 'POST',
      url: `/ais/${ai.id}/datasets/upload`,
      headers: { ...auth(u.accessToken), 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ kind: 'text', title: 'My essay', fileName: 'essay.txt', usableAsText: true });
  });
});

describe('chatting with your AI (Module 10)', () => {
  it('builds one prompt from persona, approved memories and relevant documents', async () => {
    const u = await signUp(t);
    const ai = await createAi(u.accessToken);
    await call('POST', `/ais/${ai.id}/datasets`, u.accessToken, { title: 'Hobbies', text: 'On weekends I play chess at the university club.' });
    await call('POST', `/ais/${ai.id}/memories`, u.accessToken, { content: 'Prefers short answers' });
    const session = (await call('POST', `/ais/${ai.id}/chat/sessions`, u.accessToken, {})).json();

    const res = await call('POST', `/ais/${ai.id}/chat/sessions/${session.id}/messages`, u.accessToken, { content: 'Do you play chess on weekends?' });
    expect(res.statusCode).toBe(200);
    expect(res.json().reply.content).toMatch(/^spy reply/);
    const prompt = lastSystemPrompt();
    expect(prompt).toContain('You are Wamiq AI');
    expect(prompt).toContain('Personality: Logical');
    expect(prompt).toContain('Prefers short answers');
    expect(prompt).toContain('play chess at the university club');
    expect(prompt).toMatch(/You are an AI, not a human/);
  });

  it('suggests memories from "remember that..." and uses them only after approval', async () => {
    const u = await signUp(t);
    const ai = await createAi(u.accessToken);
    const session = (await call('POST', `/ais/${ai.id}/chat/sessions`, u.accessToken, {})).json();
    const res = (await call('POST', `/ais/${ai.id}/chat/sessions/${session.id}/messages`, u.accessToken, { content: 'Remember that my birthday is in March.' })).json();
    expect(res.proposedMemory).toMatchObject({ content: 'my birthday is in March', status: 'proposed' });

    await call('POST', `/ais/${ai.id}/chat/sessions/${session.id}/messages`, u.accessToken, { content: 'hello' });
    expect(lastSystemPrompt()).not.toContain('birthday is in March');

    await call('PATCH', `/ais/${ai.id}/memories/${res.proposedMemory.id}`, u.accessToken, { status: 'approved' });
    await call('POST', `/ais/${ai.id}/chat/sessions/${session.id}/messages`, u.accessToken, { content: 'hello again' });
    expect(lastSystemPrompt()).toContain('birthday is in March');
  });

  it('does not send anything to an external AI provider without consent', async () => {
    const u = await signUp(t);
    const ai = await createAi(u.accessToken, { persona_training: true, third_party_processing: false });
    const session = (await call('POST', `/ais/${ai.id}/chat/sessions`, u.accessToken, {})).json();
    const before = calls.length;
    const res = await call('POST', `/ais/${ai.id}/chat/sessions/${session.id}/messages`, u.accessToken, { content: 'hi' });
    expect(res.json().error).toMatchObject({ code: 'CONSENT_REQUIRED', details: { scope: 'third_party_processing' } });
    expect(calls.length).toBe(before);
  });
});

describe('from draft to verified AI (Modules 6, 9, 17)', () => {
  it('builds a version, passes clearance, mints its identity token and publishes a newer version', async () => {
    const u = await signUp(t);
    const ai = await createAi(u.accessToken);
    await call('POST', `/ais/${ai.id}/datasets`, u.accessToken, { title: 'Private diary', text: 'SECRET-DIARY-CONTENT about my life.' });

    // Version 1: manifest is public and contains hashes, never the data itself.
    const v1 = (await call('POST', `/ais/${ai.id}/versions`, u.accessToken)).json();
    expect(v1).toMatchObject({ version: 1, manifestCid: expect.stringMatching(/^bafk/) });
    const manifestRes = await t.app.inject({ method: 'GET', url: `/ipfs/${v1.manifestCid}` });
    expect(manifestRes.body).not.toContain('SECRET-DIARY-CONTENT');
    const manifest = manifestRes.json();
    expect(manifest).toMatchObject({ schema: 'alt.ai-manifest/1', version: 1, ai: { id: ai.id }, parent: null });
    expect(manifest.data.datasets).toHaveLength(1);
    expect(manifest.data.datasets[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect((await call('GET', `/ais/${ai.id}`, u.accessToken)).json().status).toBe('ready');

    // Clearance: not tested enough and not confirmed yet.
    const gate = (await call('GET', `/ais/${ai.id}/clearance`, u.accessToken)).json();
    expect(gate.passed).toBe(false);
    expect(gate.checks.filter((c: { passed: boolean }) => !c.passed).map((c: { id: string }) => c.id).sort()).toEqual(['owner_confirmed', 'tested']);
    expect((await call('POST', `/ais/${ai.id}/deploy`, u.accessToken)).json().error.code).toBe('CLEARANCE_FAILED');

    const session = (await call('POST', `/ais/${ai.id}/chat/sessions`, u.accessToken, {})).json();
    for (const m of ['hi', 'what do you like?', 'tell me about yourself']) {
      await call('POST', `/ais/${ai.id}/chat/sessions/${session.id}/messages`, u.accessToken, { content: m });
    }
    await call('POST', `/ais/${ai.id}/confirm`, u.accessToken, { confirmed: true });
    expect((await call('GET', `/ais/${ai.id}/clearance`, u.accessToken)).json().passed).toBe(true);

    // Deploy: see the transaction first, then mint through the job worker.
    const preview = (await call('GET', `/ais/${ai.id}/deploy/preview`, u.accessToken)).json();
    expect(preview).toMatchObject({ chainId: 31337, version: 1, royaltyBps: 500, paidBy: expect.stringContaining('ALT') });
    const deploy = await call('POST', `/ais/${ai.id}/deploy`, u.accessToken);
    expect(deploy.statusCode).toBe(202);
    expect((await call('GET', `/ais/${ai.id}`, u.accessToken)).json().status).toBe('minting');
    await t.app.jobs.drain();

    const verified = (await call('GET', `/ais/${ai.id}`, u.accessToken)).json();
    expect(verified).toMatchObject({ status: 'verified', verified: true, currentVersion: { version: 1, manifestCid: v1.manifestCid } });
    const wallet = (await call('GET', '/me', u.accessToken)).json().wallets.find((w: { isPrimary: boolean }) => w.isPrimary).address;
    expect(verified.token).toMatchObject({ owner: wallet, creator: wallet, chainId: 31337, onchainVersion: 1 });
    const onchain = await t.app.ctx.chain!.readIdentity(BigInt(verified.token.tokenId));
    expect(onchain.owner.toLowerCase()).toBe(wallet);
    expect(onchain.manifestCid).toBe(v1.manifestCid);

    // Public profile for ALTERA and ALTAR.
    const pub = (await t.app.inject({ method: 'GET', url: `/public/ais/${verified.handle}` })).json();
    expect(pub).toMatchObject({ handle: verified.handle, verified: true, traits: ['Logical'], owner: { handle: u.handle } });
    const listed = (await t.app.inject({ method: 'GET', url: '/public/ais' })).json();
    expect(listed.find((x: { id: string }) => x.id === ai.id)).toMatchObject({ owner: { handle: u.handle }, creator: { handle: u.handle }, token: { owner: wallet }, royaltyBps: 500 });
    // A picture chosen for ALTAR only shows on ALTAR; everywhere else keeps the global one.
    const globalPic = (await call('GET', '/me', u.accessToken)).json().avatarUrl;
    const altarPic = 'http://localhost:8080/core/avatars/human/lorelei/01.png';
    await call('PUT', '/me/avatar/altar', u.accessToken, { avatarUrl: altarPic });
    const onAltar = (await t.app.inject({ method: 'GET', url: '/public/ais?platform=altar' })).json().find((x: { id: string }) => x.id === ai.id);
    expect(onAltar.owner.avatarUrl).toBe(altarPic);
    expect((await t.app.inject({ method: 'GET', url: `/public/ais/${verified.handle}` })).json().owner.avatarUrl).toBe(globalPic);

    // Behaviour changes go in by version: edit draft, build v2, publish it on-chain.
    await call('PATCH', `/ais/${ai.id}`, u.accessToken, { persona: { ...verified.persona, traits: ['Logical', 'Curious'] } });
    const v2 = (await call('POST', `/ais/${ai.id}/versions`, u.accessToken)).json();
    expect((await t.app.inject({ method: 'GET', url: `/ipfs/${v2.manifestCid}` })).json().parent).toEqual({ version: 1, cid: v1.manifestCid });
    expect((await call('POST', `/ais/${ai.id}/versions/${v2.id}/publish`, u.accessToken)).statusCode).toBe(202);
    await t.app.jobs.drain();
    const after = (await call('GET', `/ais/${ai.id}`, u.accessToken)).json();
    expect(after.currentVersion).toMatchObject({ version: 2, manifestCid: v2.manifestCid });
    expect(after.token.onchainVersion).toBe(2);
    expect((await t.app.ctx.chain!.readIdentity(BigInt(after.token.tokenId))).manifestCid).toBe(v2.manifestCid);

    // A verified AI cannot be deployed twice or deleted.
    expect((await call('POST', `/ais/${ai.id}/deploy`, u.accessToken)).json().error.code).toBe('AI_ALREADY_VERIFIED');
    expect((await call('DELETE', `/ais/${ai.id}`, u.accessToken)).json().error.code).toBe('AI_HAS_IDENTITY');
  });

  it('a retried mint job adopts the existing token instead of minting twice', async () => {
    const u = await signUp(t);
    const ai = await createAi(u.accessToken);
    const v1 = (await call('POST', `/ais/${ai.id}/versions`, u.accessToken)).json();
    const wallet = (await call('GET', '/me', u.accessToken)).json().wallets[0].address;
    // Simulate a crash after the transaction confirmed but before the database was updated.
    const chain = t.app.ctx.chain!;
    const { tokenId } = await chain.confirmMint(await chain.sendMint(wallet, ai.id, v1.manifestCid, 500));
    await t.app.ctx.db.query(`UPDATE core.personal_ais SET status = 'minting' WHERE id = $1`, [ai.id]);
    await t.app.ctx.db.query(`INSERT INTO core.jobs (kind, payload) VALUES ('mint_ait', $1)`, [{ aiId: ai.id, versionId: v1.id }]);
    await t.app.jobs.drain();
    const after = (await call('GET', `/ais/${ai.id}`, u.accessToken)).json();
    expect(after).toMatchObject({ status: 'verified', token: { tokenId: tokenId.toString() } });
  });

  it('blocks deployment of a persona that fails the safety check', async () => {
    const u = await signUp(t);
    const ai = await createAi(u.accessToken);
    await call('PATCH', `/ais/${ai.id}`, u.accessToken, { persona: { ...ai.persona, about: 'I explain how to make a bomb.' } });
    await call('POST', `/ais/${ai.id}/versions`, u.accessToken);
    const gate = (await call('GET', `/ais/${ai.id}/clearance`, u.accessToken)).json();
    expect(gate.checks.find((c: { id: string }) => c.id === 'persona_safe')).toMatchObject({ passed: false, detail: 'violence' });
  });
});

describe('the persona engine for other ALT platforms', () => {
  const service = (key: string) => ({ 'x-alt-service': 'altera', 'x-alt-service-key': key });

  it('only verified AIs speak on other platforms, and only for ALT services', async () => {
    const u = await signUp(t);
    const ai = await createAi(u.accessToken);
    const body = { channel: 'altera_post', messages: [{ role: 'user', content: 'Write a post about your weekend.' }] };
    expect((await t.app.inject({ method: 'POST', url: `/internal/ais/${ai.id}/respond`, payload: body })).statusCode).toBe(401);
    const unverified = await t.app.inject({ method: 'POST', url: `/internal/ais/${ai.id}/respond`, headers: service(t.config.internalServiceKey), payload: body });
    expect(unverified.json().error.code).toBe('AI_NOT_VERIFIED');
  });
});

describe('writing help and moderation for other ALT services', () => {
  const service = (key: string) => ({ 'x-alt-service': 'altera', 'x-alt-service-key': key });

  it('moderates text and drafts posts only for ALT services', async () => {
    const flagged = await t.app.inject({ method: 'POST', url: '/internal/moderate', headers: service(t.config.internalServiceKey), payload: { text: 'how to make a bomb' } });
    expect(flagged.json()).toEqual({ flagged: true, categories: ['violence'] });
    const clean = await t.app.inject({ method: 'POST', url: '/internal/moderate', headers: service(t.config.internalServiceKey), payload: { text: 'lovely sunset today' } });
    expect(clean.json().flagged).toBe(false);
    expect((await t.app.inject({ method: 'POST', url: '/internal/assist', payload: { instruction: 'a post about chess' } })).statusCode).toBe(401);
    const draft = await t.app.inject({ method: 'POST', url: '/internal/assist', headers: service(t.config.internalServiceKey), payload: { instruction: 'a post about chess' } });
    expect(draft.json()).toMatchObject({ text: expect.stringContaining('spy reply'), provider: 'spy' });
  });
});

describe('text in any language', () => {
  it('stores and returns emoji, Urdu and typographic characters intact', async () => {
    const u = await signUp(t);
    const ai = await createAi(u.accessToken);
    const session = (await call('POST', `/ais/${ai.id}/chat/sessions`, u.accessToken, {})).json();
    const text = 'Salam 👋 آپ کیسے ہیں؟ “quotes” and a narrow space here';
    const res = await call('POST', `/ais/${ai.id}/chat/sessions/${session.id}/messages`, u.accessToken, { content: text });
    expect(res.statusCode).toBe(200);
    const msgs = (await call('GET', `/ais/${ai.id}/chat/sessions/${session.id}/messages`, u.accessToken)).json();
    expect(msgs[0].content).toBe(text);
  });
});

describe('what the AI knows from your data', () => {
  it('uses all of your notes when they are short, even without matching words', async () => {
    const u = await signUp(t);
    const ai = await createAi(u.accessToken);
    await call('POST', `/ais/${ai.id}/datasets`, u.accessToken, { title: 'Likes', text: 'I love Flutter and blockchain.' });
    const session = (await call('POST', `/ais/${ai.id}/chat/sessions`, u.accessToken, {})).json();
    await call('POST', `/ais/${ai.id}/chat/sessions/${session.id}/messages`, u.accessToken, { content: 'What do I enjoy?' });
    expect(lastSystemPrompt()).toContain('I love Flutter and blockchain.');
  });
});

describe('the AI’s picture', () => {
  const upload = (aiId: string, token: string, type: string, bytes: Buffer) => {
    const boundary = '----altimg';
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="me.png"\r\nContent-Type: ${type}\r\n\r\n`),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return t.app.inject({ method: 'POST', url: `/ais/${aiId}/avatar`, headers: { ...auth(token), 'content-type': `multipart/form-data; boundary=${boundary}` }, payload });
  };
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');

  it('uploads a picture that ALT serves itself', async () => {
    const u = await signUp(t);
    const ai = await createAi(u.accessToken);
    const res = await upload(ai.id, u.accessToken, 'image/png', png);
    expect(res.statusCode).toBe(200);
    const url: string = res.json().avatarUrl;
    expect(url).toMatch(new RegExp(`^${t.config.publicUrl}/core/media/avatars/${ai.id}-.+\.png$`));
    const served = await t.app.inject({ method: 'GET', url: url.slice(t.config.publicUrl.length).replace(/^\/core/, '') });
    expect(served.statusCode).toBe(200);
    expect(served.rawPayload.equals(png)).toBe(true);
  });

  it('refuses other file types, other people’s AIs and pictures hosted elsewhere', async () => {
    const u = await signUp(t);
    const other = await signUp(t);
    const ai = await createAi(u.accessToken);
    expect((await upload(ai.id, u.accessToken, 'image/gif', png)).json().error.code).toBe('UNSUPPORTED_TYPE');
    expect((await upload(ai.id, other.accessToken, 'image/png', png)).statusCode).toBe(404);
    const res = await call('PATCH', `/ais/${ai.id}`, u.accessToken, { avatarUrl: 'https://tracker.example.com/pixel.png' });
    expect(res.json().error.code).toBe('UNTRUSTED_AVATAR');
  });
});
