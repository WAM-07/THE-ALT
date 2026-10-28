import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { notify } from '../src/lib/notify.js';
import { sendDigests } from '../src/modules/notifications/settings.js';
import { auth, makeApp, signUp, type TestApp } from './helpers.js';

// Module 2: notification preferences and the e-mail digest.

let t: TestApp;
beforeAll(async () => {
  t = await makeApp();
});
afterAll(async () => {
  await t.app.close();
});

const call = (method: string, url: string, token: string, payload?: object) => t.app.inject({ method: method as 'GET', url, headers: auth(token), payload });

describe('notification settings (Module 2)', () => {
  it('keeps muted categories out of the inbox, but never security notices', async () => {
    const u = await signUp(t);
    expect((await call('GET', '/notifications/settings', u.accessToken)).json()).toMatchObject({ digest: 'off', alwaysOn: ['security', 'system'] });
    // Security can't be muted.
    expect((await call('PUT', '/notifications/settings', u.accessToken, { muted: ['security'], pushMuted: [], digest: 'off' })).statusCode).toBe(400);
    const saved = (await call('PUT', '/notifications/settings', u.accessToken, { muted: ['social'], pushMuted: ['transaction'], digest: 'daily' })).json();
    expect(saved.categories).toEqual(expect.arrayContaining([{ category: 'social', inbox: false, push: true }, { category: 'transaction', inbox: true, push: false }]));

    const db = t.app.ctx.db;
    expect(await notify(db, { userId: u.user.id, category: 'social', type: 'social.like', title: 'Someone liked your post' })).toBeNull();
    expect(await notify(db, { userId: u.user.id, category: 'security', type: 'security.test', title: 'New sign-in' })).toEqual(expect.any(String));
    const titles = (await call('GET', '/notifications', u.accessToken)).json().items.map((n: { title: string }) => n.title);
    expect(titles).toContain('New sign-in');
    expect(titles).not.toContain('Someone liked your post');
  });

  it('e-mails a digest of unread notifications once a day, and nothing when there is nothing new', async () => {
    const u = await signUp(t);
    await call('PUT', '/notifications/settings', u.accessToken, { muted: [], pushMuted: [], digest: 'daily' });
    await notify(t.app.ctx.db, { userId: u.user.id, category: 'ai', type: 'ai.test', title: 'Your AI scored 80%', body: 'Approve it or train again.' });

    const digests = () => t.mailer.outbox().filter((m) => m.to === u.user.email && m.subject.includes('digest'));
    await sendDigests(t.app.ctx);
    const mail = digests()[0];
    expect(mail?.subject).toMatch(/daily digest: \d+ unread/);
    expect(mail?.text).toContain('Your AI scored 80%: Approve it or train again.');

    // Not again the same day.
    await sendDigests(t.app.ctx);
    expect(digests()).toHaveLength(1);
  });
});
