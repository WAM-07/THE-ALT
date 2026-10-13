import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, makeApp, signUp, type TestApp } from './helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await makeApp();
});
afterAll(async () => {
  await t.app.close();
});

describe('ALT Account window ("Continue with ALT")', () => {
  it('serves the sign-in page locked against framing and foreign scripts', async () => {
    const page = await t.app.inject({ method: 'GET', url: '/account/' });
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(page.headers['content-security-policy']).toContain("script-src 'self'");
    // It is opened as a popup and must keep its opener to hand the code back.
    expect(page.headers['cross-origin-opener-policy']).toBe('unsafe-none');
    expect(page.body).toContain('account.js');
    expect((await t.app.inject({ method: 'GET', url: '/account/account.js' })).headers['content-type']).toContain('javascript');
  });

  it('signs in, issues a handoff code, ends its own session, and the code still works', async () => {
    const u = await signUp(t);
    // What the window does: a short "app" session for the target platform (no cookie)…
    const login = await t.app.inject({ method: 'POST', url: '/auth/login', payload: { identifier: u.email, password: u.password, platform: 'altar', client: 'app' } });
    expect(login.statusCode).toBe(200);
    expect(login.headers['set-cookie']).toBeUndefined();
    const w = login.json();
    // …asks for a code for that platform…
    const handoff = await t.app.inject({ method: 'POST', url: '/auth/handoff', payload: { target: 'altar' }, headers: auth(w.accessToken) });
    expect(handoff.statusCode).toBe(200);
    // …and closes itself without clearing any web cookie.
    const end = await t.app.inject({ method: 'DELETE', url: `/me/sessions/${w.sessionId}`, headers: auth(w.accessToken) });
    expect(end.statusCode).toBe(200);
    expect(end.headers['set-cookie']).toBeUndefined();
    expect((await t.app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: w.refreshToken } })).statusCode).toBe(401);

    // The platform redeems the code for its own session.
    const redeemed = await t.app.inject({ method: 'POST', url: '/auth/handoff/redeem', payload: { code: handoff.json().code, platform: 'altar', client: 'web' } });
    expect(redeemed.statusCode).toBe(200);
    expect(redeemed.json().user.id).toBe(u.user.id);
  });
});
