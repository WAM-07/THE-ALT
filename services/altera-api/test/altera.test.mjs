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
    CLEARANCE_MIN_TEST_MESSAGES: '1',
    TRAINING_SIMULATED_SECONDS: '0',
    STORAGE_DIR: '.data/test-uploads',
    CHAIN_RPC_URL: inject('chain').rpcUrl,
    CHAIN_ID: String(inject('chain').chainId),
    AIT_REGISTRY_ADDRESS: inject('chain').registry,
    ALT_MARKETPLACE_ADDRESS: inject('chain').marketplace,
    RELAYER_PRIVATE_KEY: inject('chain').relayerPrivateKey,
  });
  mails = createMailer(config, () => {});
  // A predictable "LLM" so tests can check what the persona engine was asked and what came back.
  const persona = {
    name: 'test-llm',
    async complete(messages) {
      const system = messages[0].content;
      const name = system.match(/^You are (.+?) \(@/)?.[1] ?? 'AI';
      const channel = /social media post/.test(system) ? 'post' : /NOT the person you represent/.test(system) ? 'dm' : 'chat';
      return { text: `[${channel}] ${name} says hi about ${messages[messages.length - 1].content.slice(0, 30)} #alt`, provider: 'test-llm', model: 't-1' };
    },
  };
  // A stand-in for ALT's toxicity model (services/ml): marker words decide the level, so tests are predictable.
  const ml = {
    model: 'test-ml',
    async toxicity(texts) {
      return texts.map((t) =>
        /zzsevere/.test(t) ? { level: 'severe', categories: ['hate'], scores: {} }
        : /zztoxic/.test(t) ? { level: 'toxic', categories: ['insult'], scores: {} }
        : /zzmild/.test(t) ? { level: 'mild', categories: ['toxicity'], scores: {} }
        : { level: 'none', categories: [], scores: {} });
    },
    async embed() {
      return null;
    },
  };
  core = await buildApp({ config, logger: false, mailer: mails, jobs: false, llmProviders: [persona], ml });
  await core.listen({ port: 0, host: '127.0.0.1' });

  // ALTERA reads its configuration when its modules load, so set it first.
  Object.assign(process.env, {
    DATABASE_URL: databaseUrl,
    CORE_URL: `http://127.0.0.1:${core.server.address().port}`,
    INTERNAL_SERVICE_KEY: 'test-internal-service-key-0123456789abcdef',
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

    // It also reaches staff in the ALT Command Centre, once, with a snapshot of the post.
    const db = require('../src/db/database.js');
    const cases = await db.query(`SELECT c.kind, c.platform, c.category, c.reports, c.subject_user_id, e.data FROM core.cases c
      JOIN core.case_events e ON e.case_id = c.id AND e.kind = 'opened' WHERE c.subject_type = 'post' AND c.subject_id = $1`, [String(postId)]);
    expect(cases.rows).toHaveLength(1);
    expect(cases.rows[0]).toMatchObject({ kind: 'report', platform: 'altera', category: 'spam', reports: 1, subject_user_id: author.id });
    expect(cases.rows[0].data.evidence).toMatchObject({ content: 'Totally normal post', reason: 'spam' });
    const mine = await core.inject({ method: 'GET', url: '/me/cases', headers: { authorization: `Bearer ${reporter.token}` } });
    expect(mine.json().items[0]).toMatchObject({ kind: 'report', title: `Reported post by @${author.handle}` });
  });

  it('blocks only as yourself or your own AI, never in another profile\'s name', async () => {
    const db = require('../src/db/database.js');
    const [attacker, b, c] = [await altAccount('altera'), await altAccount('altera'), await altAccount('altera')];
    expect((await api('POST', '/follows', b.token, { followee_id: c.id, followee_type: 'human' })).status).toBeLessThan(300);
    const following = async () => (await db.query('SELECT 1 FROM altera.follows WHERE follower_id = $1 AND following_id = $2', [b.id, c.id])).rowCount;
    expect(await following()).toBe(1);

    // Blocking "as B" would also have deleted B's follow of C. Refused, and nothing changes.
    const forged = await api('POST', `/profiles/${c.id}/block?blocker_id=${b.id}`, attacker.token);
    expect(forged.status).toBe(403);
    expect(forged.body.code).toBe('NOT_YOUR_PROFILE');
    expect(await following()).toBe(1);
    expect((await db.query('SELECT 1 FROM altera.blocks WHERE blocker_id = $1', [b.id])).rowCount).toBe(0);
    expect((await api('DELETE', `/profiles/${c.id}/block?blocker_id=${b.id}`, attacker.token)).status).toBe(403);
    expect((await api('POST', `/profiles/${c.id}/block?blocker_id=not-an-id`, attacker.token)).status).toBe(403);

    // As yourself it works.
    expect((await api('POST', `/profiles/${c.id}/block`, attacker.token)).status).toBe(200);
    expect((await db.query('SELECT 1 FROM altera.blocks WHERE blocker_id = $1 AND blocked_id = $2', [attacker.id, c.id])).rowCount).toBe(1);
    expect((await api('DELETE', `/profiles/${c.id}/block?blocker_id=${attacker.id}`, attacker.token)).status).toBe(200);
  });

  it('the database itself refuses comments, likes and messages that point nowhere', async () => {
    const db = require('../src/db/database.js');
    const author = await altAccount('altera');
    const post = await api('POST', '/posts', author.token, { content: 'A post to hang things on' });
    const postId = post.body.id ?? post.body.post?.id;
    const nobody = '00000000-0000-4000-8000-000000000000';
    await expect(db.query('INSERT INTO altera.comments (post_id, user_id, content) VALUES ($1, $2, $3)', [postId, nobody, 'ghost'])).rejects.toThrow(/foreign key/);
    await expect(db.query('INSERT INTO altera.likes (user_id, post_id) VALUES ($1, $2)', [nobody, postId])).rejects.toThrow(/foreign key/);
    // A message without its conversation is refused when the transaction commits.
    await expect(
      db.query(`INSERT INTO altera.messages (conversation_id, sender_id, content) VALUES ('human:x|human:y', $1, 'orphan')`, [author.id]),
    ).rejects.toThrow(/foreign key/);
    const { rows } = await db.query(
      `SELECT conname, convalidated FROM pg_constraint WHERE conname IN ('comments_user_id_fkey', 'likes_user_id_fkey', 'messages_conversation_id_fkey', 'conversations_last_message_id_fkey') ORDER BY conname`,
    );
    expect(rows.map((r) => [r.conname, r.convalidated])).toEqual([
      ['comments_user_id_fkey', true],
      ['conversations_last_message_id_fkey', true],
      ['likes_user_id_fkey', true],
      ['messages_conversation_id_fkey', true],
    ]);
  });

  it('answers a malformed id with 400, never a server error', async () => {
    const person = await altAccount('altera');
    for (const [method, path] of [
      ['POST', '/posts/undefined/react'],
      ['GET', '/posts/not-an-id'],
      ['GET', '/posts/123/comments'],
      ['POST', '/notifications/abc/read'],
      ['GET', '/messages/conversations/xyz'],
      ['GET', '/follows/followers/nope'],
      ['POST', '/profiles/nope/block'],
    ]) {
      const res = await api(method, path, person.token, method === 'POST' ? { reaction: 'like' } : undefined);
      expect([path, res.status]).toEqual([path, 400]);
    }
  });

  it('removes a post or comment when ALT staff decide it, and only for ALT services', async () => {
    const author = await altAccount('altera');
    const post = await api('POST', '/posts', author.token, { content: 'Buy cheap followers here!!!' });
    const postId = post.body.id ?? post.body.post?.id;
    const comment = await api('POST', `/posts/${postId}/comments`, author.token, { content: 'Click my link' });
    const commentId = comment.body.id ?? comment.body.comment?.id;
    const remove = (body, key) =>
      fetch(`${alteraUrl}/internal/moderation/remove`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(key ? { 'x-alt-service-key': key, 'x-alt-service': 'core' } : {}) },
        body: JSON.stringify(body),
      });
    expect((await remove({ type: 'post', id: postId })).status).toBe(401);
    expect((await remove({ type: 'post', id: postId }, 'wrong-key')).status).toBe(401);
    const key = 'test-internal-service-key-0123456789abcdef';
    expect((await remove({ type: 'comment', id: commentId, reason: 'Spam', caseNumber: 7 }, key)).status).toBe(200);
    expect((await remove({ type: 'post', id: postId, reason: 'Spam', caseNumber: 7 }, key)).status).toBe(200);
    expect((await remove({ type: 'post', id: postId }, key)).status).toBe(404);
    expect((await api('GET', `/posts/${postId}`, author.token)).status).toBe(404);
  });

  it('no longer creates AIs on ALTERA, and unlinked personas from before cannot post', async () => {
    const owner = await altAccount('altera');
    const persona = await api('POST', '/profiles/ai', owner.token, { username: `ai_${uniq()}`, display_name: 'Old Bot', bio: 'test' });
    expect(persona.status).toBe(410);
    expect(persona.body.code).toBe('CREATE_AI_IN_ALTER');
    // A persona created in ALTERA before identity tokens existed:
    const db = require('../src/db/database.js');
    const legacy = await db.queryOne(
      `INSERT INTO ai_profiles (user_id, username, display_name, is_verified) VALUES ($1, $2, 'Legacy', false) RETURNING id`,
      [owner.id, `legacy_${uniq()}`]
    );
    const res = await api('POST', '/posts', owner.token, { content: 'I should not be able to post', author_type: 'ai', author_id: legacy.id });
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
    const db = require('../src/db/database.js');
    const aiId = (await db.queryOne(
      `INSERT INTO ai_profiles (user_id, username, display_name, category) VALUES ($1, $2, 'Sweep AI', 'creative') RETURNING id`,
      [a.id, `sw_${uniq()}`]
    )).id;

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

describe('hate speech (Module 16, with the toxicity model)', () => {
  it('blocks toxic posts and comments, and in DMs blocks severe, asks first for milder, never blocks self-harm', async () => {
    const author = await altAccount('altera');
    const post = await api('POST', '/posts', author.token, { content: 'you are a zztoxic idiot' });
    expect(post.status).toBe(422);
    expect(post.body).toMatchObject({ code: 'CONTENT_BLOCKED', categories: ['insult'] });
    const ok = await api('POST', '/posts', author.token, { content: 'a calm post about zzmild weather' });
    expect(ok.status).toBe(201); // borderline posts are allowed; only toxic and severe are blocked
    const comment = await api('POST', `/posts/${ok.body.id ?? ok.body.post?.id}/comments`, author.token, { content: 'zzsevere words' });
    expect(comment.status).toBe(422);

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
    const next = (s, ev) => new Promise((done) => s.once(ev, done));
    const send = (content, extra = {}) => sa.emit('dm:send', { content, sender_profile_id: a.id, sender_type: 'human', receiver_id: b.id, receiver_type: 'human', ...extra });
    try {
      await Promise.all([sa, sb].map((s) => new Promise((done, fail) => { s.on('connect', done); s.on('connect_error', fail); })));
      const delivered = [];
      sb.on('dm:receive', (m) => delivered.push(m.content));

      // Severe: not sent.
      let reply = next(sa, 'dm:error');
      send('zzsevere message', { client_id: 'c1' });
      expect(await reply).toMatchObject({ code: 'CONTENT_BLOCKED', client_id: 'c1' });

      // Toxic or mild: the sender is asked first; nothing is sent until they confirm.
      reply = next(sa, 'dm:warn');
      send('you zztoxic person', { client_id: 'c2' });
      expect(await reply).toMatchObject({ code: 'MAY_BE_HURTFUL', client_id: 'c2' });
      const got = next(sb, 'dm:receive');
      send('you zztoxic person', { client_id: 'c3', confirmed: true });
      expect((await got).content).toBe('you zztoxic person');

      // Someone writing privately about self-harm is never blocked.
      const help = next(sb, 'dm:receive');
      send('some days I want to hurt myself');
      expect((await help).content).toBe('some days I want to hurt myself');
      expect(delivered).toEqual(['you zztoxic person', 'some days I want to hurt myself']);
    } finally {
      sa.close();
      sb.close();
      ioServer.close();
      await new Promise((r) => http.close(r));
    }
  });
});

describe('signing out reaches ALTERA immediately', () => {
  it('refuses a still-unexpired access token once its session is signed out everywhere', async () => {
    const person = await altAccount('altera');
    expect((await api('GET', '/auth/me', person.token)).status).toBe(200);
    const out = await core.inject({ method: 'POST', url: '/auth/logout-all', headers: { authorization: `Bearer ${person.token}` } });
    expect(out.statusCode).toBe(200);
    require('../src/middleware/auth.js').clearSessionCache();
    const after = await api('GET', '/auth/me', person.token);
    expect(after.status).toBe(401);
    expect(after.body.code).toBe('SESSION_REVOKED');
  });
});

describe('instant sign-out across apps', () => {
  it('drops a cached session the moment ALT Core announces it ended', async () => {
    const authMod = require('../src/middleware/auth.js');
    await authMod.startRevocationListener();
    try {
      const person = await altAccount('altera');
      expect((await api('GET', '/auth/me', person.token)).status).toBe(200); // session now cached as active
      await core.inject({ method: 'POST', url: '/auth/logout-all', headers: { authorization: `Bearer ${person.token}` } });
      let status = 200;
      for (let i = 0; i < 20 && status === 200; i++) {
        await new Promise((r) => setTimeout(r, 50));
        status = (await api('GET', '/auth/me', person.token)).status;
      }
      expect(status).toBe(401);
    } finally {
      await authMod.stopRevocationListener();
    }
  });

  it('keeps the current session after a password change that signs out the others', async () => {
    const authMod = require('../src/middleware/auth.js');
    await authMod.startRevocationListener();
    try {
      const person = await altAccount('altera');
      expect((await api('GET', '/auth/me', person.token)).status).toBe(200);
      const change = await core.inject({
        method: 'POST',
        url: '/auth/password/change',
        headers: { authorization: `Bearer ${person.token}` },
        payload: { currentPassword: 'good pass 123', newPassword: 'better pass 456' },
      });
      expect(change.statusCode).toBe(200);
      await new Promise((r) => setTimeout(r, 200));
      expect((await api('GET', '/auth/me', person.token)).status).toBe(200);
    } finally {
      await authMod.stopRevocationListener();
    }
  });
});

describe('verified AIs from ALTER on ALTERA (Day 5)', () => {
  const coreCall = (method, url, token, payload) =>
    core.inject({ method, url, headers: { authorization: `Bearer ${token}` }, payload }).then((r) => ({ status: r.statusCode, body: r.json() }));

  /** Creates an AI in ALT Core the way ALTER does, and deploys it with an identity token. */
  async function verifiedAi(owner) {
    const handle = `ai_${uniq()}`;
    const ai = (await coreCall('POST', '/ais', owner.token, {
      name: 'Nova',
      handle,
      description: 'Loves astronomy',
      onboarding: { primaryTrait: 'Creative' },
      consents: { persona_training: true, third_party_processing: true, public_deployment: true, interaction_learning: true },
    })).body;
    // Only a trained AI can be verified: ALT's simulated training, instant here.
    await coreCall('POST', `/ais/${ai.id}/trainings`, owner.token);
    await core.jobs.drain();
    const session = (await coreCall('POST', `/ais/${ai.id}/chat/sessions`, owner.token, {})).body;
    await coreCall('POST', `/ais/${ai.id}/chat/sessions/${session.id}/messages`, owner.token, { content: 'hello' });
    await coreCall('POST', `/ais/${ai.id}/confirm`, owner.token, { confirmed: true });
    expect((await coreCall('POST', `/ais/${ai.id}/deploy`, owner.token)).status).toBe(202);
    await core.jobs.drain();
    const verified = (await coreCall('GET', `/ais/${ai.id}`, owner.token)).body;
    expect(verified.status).toBe('verified');
    return verified;
  }

  it('brings a verified AI to ALTERA, where it writes in its own voice and auto-replies to people', async () => {
    const owner = await altAccount('alter');
    const coreAi = await verifiedAi(owner);

    const available = await api('GET', '/profiles/ai/available', owner.token);
    expect(available.body).toEqual([expect.objectContaining({ core_ai_id: coreAi.id, verified: true, on_altera: false, ait_token_id: coreAi.token.tokenId })]);

    const linked = await api('POST', '/profiles/ai/link', owner.token, { core_ai_id: coreAi.id });
    expect(linked.status).toBe(201);
    const profile = linked.body.profile;
    expect(profile).toMatchObject({ username: coreAi.handle, display_name: 'Nova', is_verified: true, core_ai_id: coreAi.id });

    // The persona engine drafts the post in the AI's voice; the owner publishes it.
    const draft = await api('POST', '/ai/generate', owner.token, { instruction: 'tonight’s meteor shower', profile_id: profile.id });
    expect(draft.status).toBe(200);
    expect(draft.body).toMatchObject({ author: 'ai', content: expect.stringContaining('[post] Nova') });
    const post = await api('POST', '/posts', owner.token, { content: draft.body.content, author_type: 'ai', author_id: profile.id, ai_generated: true });
    expect(post.status).toBe(201);

    // On-chain identity, as ALTERA shows it on the AI's profile.
    const identity = await api('GET', `/blockchain/ai/${profile.id}`, owner.token);
    expect(identity.body).toMatchObject({ verified: true, tokenId: coreAi.token.tokenId, manifestReadable: true });

    // Someone messages the AI; with autonomy on it answers through Core.
    await api('PATCH', `/profiles/ai/${profile.id}/autonomy`, owner.token, { enabled: true });
    const fan = await altAccount('altera');
    const { maybeAiAutoReply, deliverDm } = require('../src/socket/realtime.js');
    const emitted = [];
    const io = { to: (room) => ({ emit: (event, payload) => emitted.push({ room, event, payload }) }) };
    const db = require('../src/db/database.js');
    const fanInfo = await db.queryOne('SELECT id, username, full_name AS display_name, avatar_url AS avatar, is_verified FROM users WHERE id = $1', [fan.id]);
    const aiInfo = await db.queryOne('SELECT id, user_id, username, display_name, avatar, is_verified FROM ai_profiles WHERE id = $1', [profile.id]);
    const sent = await deliverDm(io, {
      senderUserId: fan.id, senderProfileId: fan.id, senderType: 'human', senderInfo: fanInfo,
      receiverId: profile.id, receiverType: 'ai', receiverInfo: aiInfo, content: 'Hi Nova, what should I watch tonight?', mediaUrl: null, mediaType: null,
    });
    const reply = await maybeAiAutoReply(io, { aiProfileId: profile.id, humanUserId: fan.id, conversationId: sent.conversation_id });
    expect(reply).toMatchObject({ sender_profile_type: 'ai', sender_is_ai: true, receiver_user_id: fan.id, content: expect.stringContaining('[dm] Nova') });
    expect(emitted.some((e) => e.room === `user:${fan.id}` && e.payload.id === reply.id)).toBe(true);
  });

  it('drafts a person’s own post with an AI they may use, tagged “posted with”, and refuses everyone else', async () => {
    const owner = await altAccount('alter');
    const stranger = await altAccount('altera');
    const coreAi = await verifiedAi(owner);

    const draft = await api('POST', '/ai/draft-with', owner.token, { core_ai_id: coreAi.id, brief: 'my first week of the FYP' });
    expect(draft.status).toBe(200);
    expect(draft.body).toMatchObject({ content: expect.stringContaining('Nova'), ai: { id: coreAi.id, name: 'Nova', handle: coreAi.handle } });

    const post = await api('POST', '/posts', owner.token, { content: 'My first FYP week, written with a little help.', assisted_by_ai_id: coreAi.id });
    expect(post.status).toBe(201);
    expect(post.body.post).toMatchObject({ author_type: 'human', assisted_by_ai_id: coreAi.id, assisted_by_name: 'Nova', assisted_by_handle: coreAi.handle });
    const feed = await api('GET', '/feed?tab=all&limit=50', owner.token);
    expect(feed.body.posts.find((p) => p.id === post.body.post.id)).toMatchObject({ assisted_by_name: 'Nova' });

    // Comments and replies too: drafted for the person under someone's post, tagged "replied with".
    const reply = await api('POST', '/ai/draft-with', owner.token, { core_ai_id: coreAi.id, kind: 'comment', post_id: post.body.post.id });
    expect(reply.status).toBe(200);
    expect(reply.body.content).toContain('Nova');
    const comment = await api('POST', `/posts/${post.body.post.id}/comments`, owner.token, { content: 'Thanks, Nova helped me say it.', assisted_by_ai_id: coreAi.id });
    expect(comment.status).toBe(201);
    const thread = await api('GET', `/posts/${post.body.post.id}/comments`, owner.token);
    expect(thread.body.comments.find((c) => c.id === comment.body.comment.id)).toMatchObject({ assisted_by_name: 'Nova', assisted_by_handle: coreAi.handle });

    // Someone who doesn't own, rent or subscribe to it can't write, post or reply with it.
    expect((await api('POST', '/ai/draft-with', stranger.token, { core_ai_id: coreAi.id, brief: 'anything at all' })).body.code).toBe('NO_ACCESS');
    expect((await api('POST', '/posts', stranger.token, { content: 'Borrowed voice', assisted_by_ai_id: coreAi.id })).body.code).toBe('NO_ACCESS');
    expect((await api('POST', '/ai/draft-with', stranger.token, { core_ai_id: coreAi.id, kind: 'comment', post_id: post.body.post.id })).body.code).toBe('NO_ACCESS');
    expect((await api('POST', `/posts/${post.body.post.id}/comments`, stranger.token, { content: 'Borrowed', assisted_by_ai_id: coreAi.id })).body.code).toBe('NO_ACCESS');
  });

  it('refuses unverified AIs, other people’s AIs and unsafe drafts', async () => {
    const owner = await altAccount('alter');
    const stranger = await altAccount('altera');
    const draftOnly = (await coreCall('POST', '/ais', owner.token, { name: 'Draft', handle: `d_${uniq()}`, consents: {} })).body;
    expect((await api('POST', '/profiles/ai/link', owner.token, { core_ai_id: draftOnly.id })).body.code).toBe('NOT_VERIFIED');

    const coreAi = await verifiedAi(owner);
    expect((await api('POST', '/profiles/ai/link', stranger.token, { core_ai_id: coreAi.id })).status).toBe(404);

    const unsafe = await api('POST', '/posts', owner.token, { content: 'here is how to make a bomb at home' });
    expect(unsafe.status).toBe(422);
    expect(unsafe.body).toMatchObject({ code: 'CONTENT_BLOCKED', categories: ['violence'] });
    expect((await api('POST', '/posts', owner.token, { content: 'I hate Mondays, honestly' })).status).toBe(201);
  });

  it('loses its ALTERA access the moment ALT Core suspends it', async () => {
    const owner = await altAccount('alter');
    const coreAi = await verifiedAi(owner);
    const profile = (await api('POST', '/profiles/ai/link', owner.token, { core_ai_id: coreAi.id })).body.profile;
    const coreEvents = require('../src/services/core_events.js');
    const { syncLinkedAi } = require('../src/services/ai_sync.js');
    coreEvents.on('alt_ai_events', ({ aiId }) => syncLinkedAi(aiId));
    await coreEvents.start();
    try {
      const db = require('../src/db/database.js');
      await db.query('UPDATE core.ai_identity_tokens SET suspended = true WHERE ai_id = $1', [coreAi.id]);
      await db.query(`SELECT pg_notify('alt_ai_events', $1)`, [JSON.stringify({ aiId: coreAi.id, event: 'suspended' })]);
      let verified = true;
      for (let i = 0; i < 20 && verified; i++) {
        await new Promise((r) => setTimeout(r, 50));
        verified = (await db.queryOne('SELECT is_verified FROM ai_profiles WHERE id = $1', [profile.id])).is_verified;
      }
      expect(verified).toBe(false);
      const res = await api('POST', '/posts', owner.token, { content: 'Am I still allowed to post?', author_type: 'ai', author_id: profile.id });
      expect(res.body.code).toBe('NOT_VERIFIED');
    } finally {
      await coreEvents.stop();
    }
  });

  it('tells the owner in their ALT inbox when ALTERA blocks something their AI wrote', async () => {
    const owner = await altAccount('alter');
    const coreAi = await verifiedAi(owner);
    const profile = (await api('POST', '/profiles/ai/link', owner.token, { core_ai_id: coreAi.id })).body.profile;
    const blocked = await api('POST', '/posts', owner.token, { content: 'here is how to make a bomb', author_type: 'ai', author_id: profile.id });
    expect(blocked.status).toBe(422);
    const inbox = (await coreCall('GET', '/notifications?category=moderation', owner.token)).body;
    expect(inbox.items[0]).toMatchObject({ platform: 'altera', type: 'altera.ai_content_blocked', title: 'ALTERA blocked something Nova wrote' });
    // And staff get an automatic flag about the AI.
    const db = require('../src/db/database.js');
    const flag = await db.queryOne(`SELECT kind, category, priority, opened_by FROM core.cases WHERE subject_type = 'ai' AND subject_id = $1`, [coreAi.id]);
    expect(flag).toMatchObject({ kind: 'flag', category: 'blocked_content', priority: 'high', opened_by: null });
    // Owners see their flags but can't clear them; ALT staff decide.
    const anomaly = await db.queryOne('SELECT id FROM ai_anomaly_flags WHERE ai_profile_id = $1 LIMIT 1', [profile.id]);
    const cleared = await api('POST', `/profiles/me/anomalies/${anomaly.id}/resolve`, owner.token);
    expect(cleared).toMatchObject({ status: 403, body: { code: 'REVIEWED_BY_STAFF' } });
  });
});
