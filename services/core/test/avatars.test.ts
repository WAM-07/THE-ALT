import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assignDefaultAvatars } from '../src/jobs/default-avatars.js';
import { auth, makeApp, signUp, uniq, type TestApp } from './helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await makeApp();
});
afterAll(async () => {
  await t.app.close();
});

const BASE = 'http://localhost:8080/core/avatars/';
const call = (method: string, url: string, token: string, payload?: object) => t.app.inject({ method: method as 'GET', url, headers: auth(token), payload });

async function presets(kind: 'human' | 'ai') {
  const res = await t.app.inject({ method: 'GET', url: `/avatars/presets?kind=${kind}` });
  expect(res.statusCode).toBe(200);
  return res.json().sets as { id: string; kind: string; credit: string; pictures: string[] }[];
}

describe('ready-made profile pictures', () => {
  it('lists separate sets for people and AIs, with credits, and serves the images', async () => {
    const human = await presets('human');
    const ai = await presets('ai');
    expect(human.map((s) => s.id)).toContain('chibi');
    expect(ai.map((s) => s.id)).toContain('mecha');
    expect(human.every((s) => s.kind === 'human' && s.credit && s.pictures.length > 0)).toBe(true);
    expect(ai.every((s) => s.kind === 'ai')).toBe(true);

    const img = await t.app.inject({ method: 'GET', url: human[0]!.pictures[0]!.replace('http://localhost:8080/core', '') });
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');
    // Only files in the list: no wandering around the disk.
    expect((await t.app.inject({ method: 'GET', url: '/avatars/human/chibi/99.png' })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'GET', url: '/avatars/human/..%2F..%2Fpackage.json/01.png' })).statusCode).toBe(400);
  });

  it('gives a new account a picture from the people sets, and the same one each time for the same id', async () => {
    const u = await signUp(t);
    const me = (await call('GET', '/me', u.accessToken)).json();
    expect(me.avatarUrl).toMatch(new RegExp(`^${BASE}human/`));
    expect(me.platformAvatars).toEqual({});
  });

  it('gives a new AI a picture from the AI sets', async () => {
    const u = await signUp(t);
    const ai = (await call('POST', '/ais', u.accessToken, { name: 'Bot', handle: `ai_${uniq()}`, consents: {} })).json();
    expect(ai.avatarUrl).toMatch(new RegExp(`^${BASE}ai/`));
  });

  it('keeps people and AIs apart: no robot faces for people, no human faces for AIs', async () => {
    const u = await signUp(t);
    const [human, ai] = [(await presets('human'))[0]!.pictures[1]!, (await presets('ai'))[0]!.pictures[1]!];

    const robot = await call('PATCH', '/me', u.accessToken, { avatarUrl: ai });
    expect(robot.json().error.code).toBe('AVATAR_WRONG_SET');
    const ok = await call('PATCH', '/me', u.accessToken, { avatarUrl: human });
    expect(ok.json().avatarUrl).toBe(human);
    expect((await call('PATCH', '/me', u.accessToken, { avatarUrl: `${BASE}human/chibi/42.png` })).json().error.code).toBe('AVATAR_NOT_FOUND');

    const bot = (await call('POST', '/ais', u.accessToken, { name: 'Bot', handle: `ai_${uniq()}`, consents: {} })).json();
    expect((await call('PATCH', `/ais/${bot.id}`, u.accessToken, { avatarUrl: human })).json().error.code).toBe('AVATAR_WRONG_SET');
    expect((await call('PATCH', `/ais/${bot.id}`, u.accessToken, { avatarUrl: ai })).json().avatarUrl).toBe(ai);
  });

  it('never leaves a blank circle: removing the picture brings back a ready-made one', async () => {
    const u = await signUp(t);
    const first = (await call('GET', '/me', u.accessToken)).json().avatarUrl;
    const cleared = (await call('PATCH', '/me', u.accessToken, { avatarUrl: null })).json();
    expect(cleared.avatarUrl).toBe(first);
  });

  it('lets a person use a different picture on one platform, and go back to the global one', async () => {
    const u = await signUp(t);
    const global = (await call('GET', '/me', u.accessToken)).json().avatarUrl;
    const other = (await presets('human')).flatMap((s) => s.pictures).find((p) => p !== global)!;

    const set = await call('PUT', '/me/avatar/altera', u.accessToken, { avatarUrl: other });
    expect(set.statusCode).toBe(200);
    expect(set.json()).toMatchObject({ avatarUrl: global, platformAvatars: { altera: other } });
    // ALTERA reads people through its view, which now prefers the ALTERA picture.
    const { rows } = await t.app.ctx.db.query('SELECT COALESCE(pa.avatar_url, u.avatar_url) AS a FROM core.users u LEFT JOIN core.platform_avatars pa ON pa.user_id = u.id AND pa.platform = $2 WHERE u.id = $1', [u.user.id, 'altera']);
    expect(rows[0].a).toBe(other);

    expect((await call('PUT', '/me/avatar/altera', u.accessToken, { avatarUrl: 'https://tracker.example/pixel.png' })).json().error.code).toBe('AVATAR_URL_NOT_ALLOWED');
    expect((await call('PUT', '/me/avatar/admin', u.accessToken, { avatarUrl: other })).statusCode).toBe(400);

    const back = await call('PUT', '/me/avatar/altera', u.accessToken, { avatarUrl: null });
    expect(back.json().platformAvatars).toEqual({});
  });

  it('fills in pictures for accounts made before ALT had them', async () => {
    const u = await signUp(t);
    await t.app.ctx.db.query('UPDATE core.users SET avatar_url = NULL WHERE id = $1', [u.user.id]);
    await assignDefaultAvatars(t.app.ctx, () => {});
    expect((await call('GET', '/me', u.accessToken)).json().avatarUrl).toMatch(new RegExp(`^${BASE}human/`));
  });
});
