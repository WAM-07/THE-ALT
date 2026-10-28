import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, makeApp, signUp, trainAi, uniq, type TestApp } from './helpers.js';

// Module 8 FE-4 (a consent record to download) and Module 6 (what changed between versions).

let t: TestApp;
beforeAll(async () => {
  t = await makeApp();
});
afterAll(async () => {
  await t.app.close();
});

const call = (method: string, url: string, token: string, payload?: object) => t.app.inject({ method: method as 'GET', url, headers: auth(token), payload });

describe('records the owner can download and compare', () => {
  it('lists every consent given and withdrawn, as JSON and as a readable PDF', async () => {
    const [u, other] = [await signUp(t), await signUp(t)];
    const ai = (await call('POST', '/ais', u.accessToken, { name: 'Ledger', handle: `c_${uniq()}`, consents: { persona_training: true } })).json();
    await call('PUT', `/ais/${ai.id}/consents/public_deployment`, u.accessToken, { granted: true });
    await call('PUT', `/ais/${ai.id}/consents/public_deployment`, u.accessToken, { granted: false });

    const record = (await call('GET', `/ais/${ai.id}/consents/record`, u.accessToken)).json();
    expect(record.events.map((e: { scope: string; granted: boolean }) => [e.scope, e.granted])).toEqual(
      expect.arrayContaining([['persona_training', true], ['public_deployment', true], ['public_deployment', false]]),
    );
    expect(record.current.find((c: { scope: string }) => c.scope === 'public_deployment')).toMatchObject({ granted: false });
    expect((await call('GET', `/ais/${ai.id}/consents/record`, other.accessToken)).statusCode).toBe(404);

    const pdf = await call('GET', `/ais/${ai.id}/consents/record?format=pdf`, u.accessToken);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    const { extractText, getDocumentProxy } = await import('unpdf');
    const { text } = await extractText(await getDocumentProxy(new Uint8Array(pdf.rawPayload)), { mergePages: true });
    expect(text).toContain('Consent record: Ledger');
    expect(text).toContain('withdrew public_deployment');
  });

  it('shows what changed in a version: persona, data by fingerprint, memories and engine', async () => {
    const u = await signUp(t);
    const ai = (await call('POST', '/ais', u.accessToken, { name: 'Diff', handle: `d_${uniq()}`, consents: { persona_training: true } })).json();
    const v1 = (await call('POST', `/ais/${ai.id}/versions`, u.accessToken)).json();
    expect((await call('GET', `/ais/${ai.id}/versions/${v1.id}/diff`, u.accessToken)).json().error.code).toBe('NO_PREVIOUS_VERSION');

    await call('PATCH', `/ais/${ai.id}`, u.accessToken, { persona: { ...ai.persona, traits: ['Curious'], instructions: 'secret rule' } });
    await call('POST', `/ais/${ai.id}/datasets`, u.accessToken, { title: 'Notes', text: 'Graph notes.' });
    const training = await trainAi(t, ai.id, u.accessToken);
    const diff = (await call('GET', `/ais/${ai.id}/versions/${training.versionId}/diff`, u.accessToken)).json();
    expect(diff.from).toMatchObject({ version: 1, engine: 'base' });
    expect(diff.to).toMatchObject({ version: 2, engine: 'adapter', training: 'simulated' });
    expect(diff.engineChanged).toBe(true);
    expect(diff.persona).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'traits', added: ['Curious'] }),
        { field: 'instructions', from: null, to: 'set' }, // private instructions are never shown in full
      ]),
    );
    expect(diff.data.added).toHaveLength(1);
    expect(diff.data.added[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(diff)).not.toContain('secret rule');
  });
});
