import { generateKeyPairSync } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { notify } from '../src/lib/notify.js';
import { loadPushConfig, PushSender } from '../src/lib/push.js';
import { auth, makeApp, signUp, uniq, type TestApp } from './helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await makeApp();
});
afterAll(async () => {
  await t.app.close();
});

/** A stand-in for Google: OAuth answers with a token; FCM answers per phone token. */
function fakeGoogle(fcm: (token: string) => { status: number; body: string }) {
  const sent: { token: string; title: string; body: string; data: Record<string, string> }[] = [];
  let oauth = 0;
  const impl = (async (url: string, init: RequestInit) => {
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      oauth++;
      expect(String(init.body)).toContain('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer');
      return new Response(JSON.stringify({ access_token: 'google-token', expires_in: 3600 }), { status: 200 });
    }
    expect(url).toBe('https://fcm.googleapis.com/v1/projects/alt-demo/messages:send');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer google-token');
    const { message } = JSON.parse(String(init.body));
    sent.push({ token: message.token, title: message.notification.title, body: message.notification.body, data: message.data });
    const r = fcm(message.token);
    return new Response(r.body, { status: r.status });
  }) as unknown as typeof fetch;
  return { impl, sent, oauthCalls: () => oauth };
}

const serviceAccount = () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  return JSON.stringify({ type: 'service_account', project_id: 'alt-demo', client_email: 'push@alt-demo.iam.gserviceaccount.com', private_key: privateKey });
};

describe('push notifications (Firebase Cloud Messaging)', () => {
  it('registers phones, sends each new inbox item to them, and forgets phones Firebase no longer knows', async () => {
    const u = await signUp(t);
    const live = `phone-${uniq()}-live-token`;
    const gone = `phone-${uniq()}-gone-token`;
    for (const token of [live, gone]) {
      const res = await t.app.inject({ method: 'PUT', url: '/me/push-devices', headers: auth(u.accessToken), payload: { token, platform: 'altera' } });
      expect(res.json()).toEqual({ registered: true, pushEnabled: false });
    }

    const google = fakeGoogle((token) => (token === gone ? { status: 404, body: '{"error":{"status":"NOT_FOUND","details":[{"errorCode":"UNREGISTERED"}]}}' } : { status: 200, body: '{}' }));
    const push = new PushSender(t.app.ctx.db, loadPushConfig(serviceAccount()), () => {}, google.impl);
    const id = (await notify(t.app.ctx.db, { userId: u.user.id, category: 'social', type: 'social.comment', title: 'Sara commented', body: 'Nice post!', platform: 'altera', link: 'altera://post/1' }))!;

    expect(await push.sendNotification(id)).toBe(1);
    expect(google.sent.map((s) => s.token).sort()).toEqual([gone, live].sort());
    expect(google.sent[0]).toMatchObject({ title: 'Sara commented', body: 'Nice post!', data: { notificationId: id, category: 'social', platform: 'altera', link: 'altera://post/1' } });
    const { rows } = await t.app.ctx.db.query('SELECT token FROM core.push_devices WHERE user_id = $1', [u.user.id]);
    expect(rows.map((r) => r.token)).toEqual([live]);

    // The OAuth token is reused until it nearly expires.
    await push.sendNotification(id);
    expect(google.oauthCalls()).toBe(1);

    // Someone else signing in on the same phone takes the token over.
    const other = await signUp(t);
    await t.app.inject({ method: 'PUT', url: '/me/push-devices', headers: auth(other.accessToken), payload: { token: live, platform: 'alter' } });
    expect((await t.app.ctx.db.query('SELECT user_id FROM core.push_devices WHERE token = $1', [live])).rows[0].user_id).toBe(other.user.id);
    // Signing out stops the phone's pushes with the phone's own token (there is no session any more).
    expect((await t.app.inject({ method: 'POST', url: '/push-devices/forget', payload: { token: live } })).json()).toEqual({ removed: true });
    expect((await t.app.ctx.db.query('SELECT 1 FROM core.push_devices WHERE token = $1', [live])).rowCount).toBe(0);
  });

  it('does nothing until a service account is configured', async () => {
    expect(loadPushConfig(undefined)).toBeNull();
    expect(() => loadPushConfig('{"type":"service_account"}')).toThrow(/service-account/);
    const off = new PushSender(t.app.ctx.db, null);
    expect(off.enabled).toBe(false);
    expect(await off.sendNotification('00000000-0000-0000-0000-000000000000')).toBe(0);
  });
});
