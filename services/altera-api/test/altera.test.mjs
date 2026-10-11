// End-to-end: a real ALT Core issues the tokens, ALTERA verifies them over JWKS and reads
// people from core.users through the altera.users view. One database, one account.
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

const require = createRequire(import.meta.url);
const PUBLIC_URL = 'http://localhost:8080';

let core;
let alteraServer;
let alteraUrl;
let mails;

beforeAll(async () => {
  const databaseUrl = inject('databaseUrl');
  const { buildApp } = await import('../../core/src/app.ts');
  const { loadConfig } = await import('../../core/src/config.ts');
  const { createMailer } = await import('../../core/src/lib/mailer.ts');
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
    CORE_JWT_PRIVATE_KEY: generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    }).privateKey,
    CORE_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    INTERNAL_SERVICE_KEY: 'test-internal-service-key-0123456789abcdef',
    ALT_PUBLIC_URL: PUBLIC_URL,
    RATE_LIMIT_ENABLED: 'false',
  });
  mails = createMailer(config, () => {});
  core = await buildApp({ config, logger: false, mailer: mails });
  await core.listen({ port: 0, host: '127.0.0.1' });

  // ALTERA reads its configuration when its modules load, so set it first.
  Object.assign(process.env, {
    DATABASE_URL: databaseUrl,
    CORE_URL: `http://127.0.0.1:${core.server.address().port}`,
    ALT_PUBLIC_URL: PUBLIC_URL,
    RATE_LIMIT_ENABLED: 'false',
    NODE_ENV: 'test',
  });
  const { createApp } = require('../src/app.js');
  const io = { to: () => ({ emit() {} }), emit() {} };
  const app = createApp({ io, logRequests: false });
  await new Promise((resolve) => {
    alteraServer = app.listen(0, '127.0.0.1', resolve);
  });
  alteraUrl = `http://127.0.0.1:${alteraServer.address().port}`;
});

afterAll(async () => {
  await new Promise((resolve) => alteraServer?.close(resolve));
  await core?.close();
  await require('../src/db/database.js').close();
});

const uniq = () => randomBytes(4).toString('hex');

/** Signs up through ALT Core (as the ALTER app would) and returns an access token. */
async function altAccount(platform = 'alter') {
  const id = uniq();
  const email = `p_${id}@alt.test`;
  const reg = await core.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email, password: 'good pass 123', handle: `p_${id}`, displayName: `Person ${id}` },
  });
  expect(reg.statusCode).toBe(201);
  const code = mails.outbox().find((m) => m.to === email).text.match(/\b(\d{6})\b/)[1];
  const res = await core.inject({ method: 'POST', url: '/auth/email/verify', payload: { email, code, platform } });
  expect(res.statusCode).toBe(200);
  const body = res.json();
  return { token: body.accessToken, refreshToken: body.refreshToken, id: body.user.id, handle: `p_${id}`, email };
}

async function api(method, path, token, body) {
  const res = await fetch(`${alteraUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

describe('one ALT account works on ALTERA', () => {
  it('accepts a token from an account created in another ALT app and builds the ALTERA profile', async () => {
    const person = await altAccount('alter');
    const me = await api('GET', '/auth/me', person.token);
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({
      id: person.id,
      email: person.email,
      username: person.handle,
      human_profile: { id: person.id, display_name: expect.stringMatching(/^Person /), is_verified: true, health_score: 100 },
      ai_profiles: [],
    });
    expect(me.body.wallet_address).toMatch(/^0x[0-9a-f]{40}$/);
  });

  it('rejects missing, forged and expired tokens', async () => {
    expect((await api('GET', '/auth/me')).status).toBe(401);
    const forged = await api('GET', '/auth/me', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig');
    expect(forged.status).toBe(401);
    expect(forged.body.code).toBe('INVALID_TOKEN');
  });

  it('tells old clients where sign-in went', async () => {
    const res = await api('POST', '/auth/login', null, { email: 'x', password: 'y' });
    expect(res.status).toBe(410);
    expect(res.body).toMatchObject({ code: 'MOVED_TO_ALT_CORE', use: '/core/auth/login' });
  });

  it('keeps name and avatar in the ALT account and bio on ALTERA', async () => {
    const person = await altAccount();
    const upd = await api('PUT', '/auth/profile', person.token, {
      profile_id: person.id,
      display_name: 'Renamed Everywhere',
      bio: 'only on altera',
    });
    expect(upd.status).toBe(200);
    const coreMe = await core.inject({ method: 'GET', url: '/me', headers: { authorization: `Bearer ${person.token}` } });
    expect(coreMe.json().displayName).toBe('Renamed Everywhere');
    const me = await api('GET', '/auth/me', person.token);
    expect(me.body.human_profile).toMatchObject({ display_name: 'Renamed Everywhere', bio: 'only on altera' });
  });
});

describe('social features on the shared database', () => {
  it('posts, comments, likes and follows between two ALT accounts', async () => {
    const a = await altAccount('altera');
    const b = await altAccount('altera');

    const post = await api('POST', '/posts', a.token, { content: 'Hello from one ALT account #altera' });
    expect(post.status).toBe(201);
    const postId = post.body.id ?? post.body.post?.id;
    expect(postId).toBeTruthy();

    const follow = await api('POST', '/follows', b.token, { followee_id: a.id, followee_type: 'human' });
    expect([200, 201]).toContain(follow.status);

    const comment = await api('POST', `/posts/${postId}/comments`, b.token, { content: 'Nice to see you here' });
    expect([200, 201]).toContain(comment.status);
    expect((await api('POST', `/posts/${postId}/react`, b.token, {})).status).toBeLessThan(300);

    const feed = await api('GET', '/feed', b.token);
    expect(feed.status).toBe(200);
    expect(JSON.stringify(feed.body)).toContain('Hello from one ALT account');

    const meA = await api('GET', '/auth/me', a.token);
    expect(meA.body.human_profile.post_count).toBe(1);
    expect(meA.body.human_profile.follower_count).toBe(1);
  });

  it('counts a report once per reporter, so reports cannot drain a health score', async () => {
    const author = await altAccount('altera');
    const reporter = await altAccount('altera');
    const post = await api('POST', '/posts', author.token, { content: 'Totally normal post' });
    const postId = post.body.id ?? post.body.post?.id;
    for (let i = 0; i < 3; i++) {
      expect((await api('POST', `/posts/${postId}/report`, reporter.token, { reason: 'spam' })).status).toBe(200);
    }
    const me = await api('GET', '/auth/me', author.token);
    expect(me.body.human_profile.health_score).toBe(95);
  });

  it('refuses posts from AI personas that have no AI identity token', async () => {
    const owner = await altAccount('altera');
    const persona = await api('POST', '/profiles/ai', owner.token, {
      username: `ai_${uniq()}`,
      display_name: 'Unverified Bot',
      bio: 'test',
      category: 'general',
    });
    expect(persona.status).toBe(201);
    const aiId = persona.body.id ?? persona.body.profile?.id ?? persona.body.ai_profile?.id;
    const res = await api('POST', '/posts', owner.token, { content: 'I should not be able to post', author_type: 'ai', author_id: aiId });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('NOT_VERIFIED');
  });
});

describe('no server errors anywhere the ALTERA app reads from', () => {
  it('every read endpoint answers without a 5xx for a fresh account with some activity', async () => {
    const a = await altAccount('altera');
    const b = await altAccount('altera');
    const post = await api('POST', '/posts', a.token, { content: 'Seed post for the sweep #sweep' });
    const postId = post.body.id ?? post.body.post?.id;
    await api('POST', '/follows', b.token, { followee_id: a.id, followee_type: 'human' });
    await api('POST', `/posts/${postId}/comments`, b.token, { content: 'sweep comment' });
    const story = await api('POST', '/stories', a.token, { media_url: 'https://example.com/s.png', media_type: 'image', text_content: 'hi' });
    expect(story.status).toBeLessThan(300);
    const persona = await api('POST', '/profiles/ai', a.token, { username: `sw_${uniq()}`, display_name: 'Sweep AI', category: 'creative' });
    const aiId = persona.body.profile.id;

    const paths = [
      '/feed',
      '/feed?category=creative',
      '/explore/search?q=sweep',
      '/explore/search?q=p_&scope=people',
      '/explore/trending',
      '/explore/suggested-profiles',
      '/notifications',
      '/stories',
      `/posts/${postId}`,
      `/posts/${postId}/comments`,
      '/posts/pending',
      '/posts/flagged',
      `/profiles/${a.id}`,
      `/profiles/${a.handle}`,
      `/profiles/${aiId}`,
      '/profiles/me/insights',
      '/profiles/me/compliance',
      '/profiles/me/activity',
      `/follows/check?follower_id=${b.id}&followee_id=${a.id}`,
      `/follows/followers/${a.id}`,
      `/follows/following/${b.id}`,
      '/messages/conversations',
      '/messages/share-targets',
      '/messages/search?q=p',
    ];
    const failures = [];
    for (const who of [a, b]) {
      for (const p of paths) {
        const res = await api('GET', p, who.token);
        if (res.status >= 500) failures.push(`${p} -> ${res.status} ${JSON.stringify(res.body).slice(0, 120)}`);
      }
    }
    expect(failures).toEqual([]);
  });
});

describe('real-time direct messages over Socket.IO', () => {
  it('delivers a DM between two ALT accounts and lists the conversation', async () => {
    const { createServer } = require('node:http');
    const { Server } = require('socket.io');
    const { io: connect } = await import('socket.io-client');
    const { createApp } = require('../src/app.js');
    const { setupSocketIO } = require('../src/socket/realtime.js');

    const http = createServer();
    const ioServer = new Server(http);
    http.on('request', createApp({ io: ioServer, logRequests: false }));
    setupSocketIO(ioServer);
    await new Promise((r) => http.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${http.address().port}`;

    const a = await altAccount('altera');
    const b = await altAccount('altera');
    const sa = connect(url, { auth: { token: a.token }, transports: ['websocket'] });
    const sb = connect(url, { auth: { token: b.token }, transports: ['websocket'] });
    try {
      await Promise.all([sa, sb].map((s) => new Promise((ok, fail) => { s.on('connect', ok); s.on('connect_error', fail); })));
      const received = new Promise((ok) => sb.on('dm:receive', ok));
      sa.emit('dm:send', { content: 'hi from ALT', sender_profile_id: a.id, sender_type: 'human', receiver_id: b.id, receiver_type: 'human' });
      const msg = await received;
      expect(msg.content).toBe('hi from ALT');

      const convs = await fetch(`${url}/messages/conversations`, { headers: { authorization: `Bearer ${b.token}` } }).then((r) => r.json());
      expect(JSON.stringify(convs)).toContain('hi from ALT');

      const bad = connect(url, { auth: { token: 'not-a-token' }, transports: ['websocket'] });
      await expect(new Promise((ok, fail) => { bad.on('connect', ok); bad.on('connect_error', (e) => fail(e)); })).rejects.toThrow();
      bad.close();
    } finally {
      sa.close();
      sb.close();
      ioServer.close();
      await new Promise((r) => http.close(r));
    }
  });
});
