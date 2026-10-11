import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LlmProvider } from '../src/modules/ai/llm.js';
import { ADMIN_EMAIL, auth, makeApp, signUp, uniq, type TestApp } from './helpers.js';

const quiet: LlmProvider = { name: 'mock', complete: async () => ({ text: 'ok', provider: 'mock', model: 'm' }) };

let t: TestApp;
let baseUrl: string;
beforeAll(async () => {
  t = await makeApp({}, { llmProviders: [quiet] });
  await t.app.listen({ port: 0, host: '127.0.0.1' });
  baseUrl = `http://127.0.0.1:${(t.app.server.address() as { port: number }).port}`;
});
afterAll(async () => {
  await t.app.close();
});

const inbox = async (token: string, query = '') => (await t.app.inject({ method: 'GET', url: `/notifications${query}`, headers: auth(token) })).json();
const types = (items: { type: string }[]) => items.map((n) => n.type);

describe('the ALT inbox (Module 2)', () => {
  it('alerts on new sign-ins (but not when confirming an email or moving between apps)', async () => {
    const u = await signUp(t);
    expect((await inbox(u.accessToken)).items).toEqual([]);

    await t.app.inject({ method: 'POST', url: '/auth/login', payload: { identifier: u.email, password: u.password, platform: 'altera', deviceName: 'Pixel 8' } });
    const h = (await t.app.inject({ method: 'POST', url: '/auth/handoff', headers: auth(u.accessToken), payload: { target: 'altar' } })).json();
    await t.app.inject({ method: 'POST', url: '/auth/handoff/redeem', payload: { code: h.code, platform: 'altar' } });

    const box = await inbox(u.accessToken);
    expect(types(box.items)).toEqual(['security.new_sign_in']);
    expect(box.items[0]).toMatchObject({ category: 'security', title: 'New sign-in to ALTERA', read: false, platform: 'core' });
    expect(box.items[0].body).toContain('Pixel 8');
    expect(box.unreadCount).toBe(1);
  });

  it('marks one or all as read', async () => {
    const u = await signUp(t);
    for (let i = 0; i < 2; i++) {
      await t.app.inject({ method: 'POST', url: '/auth/login', payload: { identifier: u.email, password: u.password, platform: 'alter' } });
    }
    const box = await inbox(u.accessToken);
    expect(box.unreadCount).toBe(2);
    const one = await t.app.inject({ method: 'POST', url: `/notifications/${box.items[0].id}/read`, headers: auth(u.accessToken) });
    expect(one.json().unreadCount).toBe(1);
    expect((await inbox(u.accessToken, '?unread=true')).items).toHaveLength(1);
    await t.app.inject({ method: 'POST', url: '/notifications/read-all', headers: auth(u.accessToken) });
    expect((await t.app.inject({ method: 'GET', url: '/notifications/unread-count', headers: auth(u.accessToken) })).json()).toEqual({ unreadCount: 0 });
  });

  it('warns about lockouts and password and two-factor changes', async () => {
    const u = await signUp(t);
    await t.app.inject({ method: 'POST', url: '/auth/password/change', headers: auth(u.accessToken), payload: { currentPassword: u.password, newPassword: 'new pass 12345' } });
    for (let i = 0; i < 5; i++) {
      await t.app.inject({ method: 'POST', url: '/auth/login', payload: { identifier: u.email, password: 'wrong pass 1', platform: 'alter' } });
    }
    expect(types((await inbox(u.accessToken, '?category=security')).items)).toEqual(['security.locked', 'security.password_changed']);
  });

  it('keeps everyone’s inbox private', async () => {
    const a = await signUp(t);
    const b = await signUp(t);
    await t.app.inject({ method: 'POST', url: '/auth/login', payload: { identifier: a.email, password: a.password, platform: 'alter' } });
    const id = (await inbox(a.accessToken)).items[0].id;
    expect((await t.app.inject({ method: 'POST', url: `/notifications/${id}/read`, headers: auth(b.accessToken) })).statusCode).toBe(404);
    expect((await inbox(b.accessToken)).items).toEqual([]);
  });

  it('lets other ALT services post to the inbox, labelled with where it came from', async () => {
    const u = await signUp(t);
    const payload = { userId: u.user.id, category: 'moderation', type: 'altera.ai_post_blocked', title: 'A post by your AI was blocked', body: 'violence' };
    expect((await t.app.inject({ method: 'POST', url: '/internal/notifications', payload })).statusCode).toBe(401);
    const res = await t.app.inject({
      method: 'POST',
      url: '/internal/notifications',
      headers: { 'x-alt-service': 'altera', 'x-alt-service-key': t.config.internalServiceKey },
      payload,
    });
    expect(res.statusCode).toBe(201);
    expect((await inbox(u.accessToken)).items[0]).toMatchObject({ platform: 'altera', category: 'moderation', title: 'A post by your AI was blocked' });
  });

  it('lets admins announce something to everyone', async () => {
    const someone = await signUp(t);
    let admin;
    try {
      admin = await signUp(t, { email: ADMIN_EMAIL });
    } catch {
      admin = (await t.app.inject({ method: 'POST', url: '/auth/login', payload: { identifier: ADMIN_EMAIL, password: 'correct horse 1', platform: 'admin' } })).json();
    }
    expect((await t.app.inject({ method: 'POST', url: '/admin/notifications/broadcast', headers: auth(someone.accessToken), payload: { title: 'x' } })).statusCode).toBe(403);
    const res = await t.app.inject({ method: 'POST', url: '/admin/notifications/broadcast', headers: auth(admin.accessToken), payload: { title: 'Demo day on Friday', body: 'See you there.' } });
    expect(res.json().sent).toBeGreaterThan(1);
    expect((await inbox(someone.accessToken)).items[0]).toMatchObject({ category: 'system', title: 'Demo day on Friday', platform: 'admin' });
  });

  it('tells the owner when a new version of their AI is ready', async () => {
    const u = await signUp(t);
    const ai = (await t.app.inject({
      method: 'POST',
      url: '/ais',
      headers: auth(u.accessToken),
      payload: { name: 'Nova', handle: `n_${uniq()}`, consents: { persona_training: true } },
    })).json();
    await t.app.inject({ method: 'POST', url: `/ais/${ai.id}/versions`, headers: auth(u.accessToken) });
    expect((await inbox(u.accessToken)).items[0]).toMatchObject({ category: 'ai', type: 'ai.version_built', title: 'Version 1 of Nova is ready', platform: 'alter' });
  });
});

describe('real-time delivery (Module 2 FE-4)', () => {
  it('streams a new notification to an open app the moment it is created', async () => {
    const u = await signUp(t);
    const controller = new AbortController();
    const res = await fetch(`${baseUrl}/notifications/stream`, { headers: auth(u.accessToken), signal: controller.signal });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const until = async (needle: string) => {
      const deadline = Date.now() + 5000;
      while (!buffer.includes(needle) && Date.now() < deadline) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value);
      }
      return buffer.includes(needle);
    };
    expect(await until('event: ready')).toBe(true);

    await t.app.inject({ method: 'POST', url: '/auth/login', payload: { identifier: u.email, password: u.password, platform: 'altera', deviceName: 'Stream test' } });
    expect(await until('event: notification')).toBe(true);
    const data = JSON.parse(buffer.split('event: notification\ndata: ')[1]!.split('\n')[0]!);
    expect(data).toMatchObject({ type: 'security.new_sign_in', title: 'New sign-in to ALTERA' });
    controller.abort();
  });
});
