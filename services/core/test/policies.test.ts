import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, makeApp, signUp, uniq, type TestApp } from './helpers.js';

let t: TestApp;
const bossEmail = `boss_${uniq()}@alt.test`;
let boss: Awaited<ReturnType<typeof signUp>>;

beforeAll(async () => {
  t = await makeApp({ ADMIN_EMAILS: bossEmail });
  boss = await signUp(t, { email: bossEmail, platform: 'admin' });
});
afterAll(async () => {
  await t.app.close();
});

const call = (method: string, url: string, token?: string, payload?: object) =>
  t.app.inject({ method: method as 'GET', url, ...(token ? { headers: auth(token) } : {}), payload });

describe('ALT policies (M3 FE-5)', () => {
  it('publishes Terms, Privacy and the AI content policy, records who agreed to which version, and asks again when one changes', async () => {
    // Version 1 of each ships with ALT and anyone can read it.
    const list = (await call('GET', '/policies')).json().items;
    expect(list.map((p: { slug: string; version: number }) => [p.slug, p.version]).sort()).toEqual([
      ['ai-content', 1],
      ['privacy', 1],
      ['terms', 1],
    ]);
    const terms = (await call('GET', '/policies/terms')).json();
    expect(terms).toMatchObject({ title: 'Terms of use', publishedBy: 'ALT', versions: [{ version: 1 }] });
    expect(terms.body).toContain('## One account');
    expect((await call('GET', '/policies/terms?version=9')).statusCode).toBe(404);

    // A person agrees, one policy at a time, to the current version only.
    const person = await signUp(t, { platform: 'altera' });
    expect((await call('GET', '/me/policies', person.accessToken)).json().pending).toHaveLength(3);
    expect((await call('POST', '/me/policies/accept', person.accessToken, { slug: 'terms', version: 2 })).json().error.code).toBe('NOT_CURRENT_VERSION');
    const after = (await call('POST', '/me/policies/accept', person.accessToken, { slug: 'terms', version: 1 })).json();
    expect(after.pending.map((p: { slug: string }) => p.slug).sort()).toEqual(['ai-content', 'privacy']);
    await call('POST', '/me/policies/accept', person.accessToken, { slug: 'terms', version: 1 }); // twice counts once
    const { rows } = await t.app.ctx.db.query('SELECT platform FROM core.policy_acceptances WHERE user_id = $1', [person.user.id]);
    expect(rows).toEqual([{ platform: 'altera' }]);

    // Only admins publish, from the Command Centre; everyone is told and asked again.
    const mod = await signUp(t);
    await call('PUT', `/admin/users/${mod.user.id}/roles`, boss.accessToken, { roles: ['participant', 'moderator'] });
    const modToken = (await t.app.inject({ method: 'POST', url: '/auth/login', payload: { identifier: mod.email, password: mod.password, platform: 'admin' } })).json().accessToken;
    const v2 = { title: 'Terms of use', summary: 'Rentals now last whole days.', body: '## Rentals\n- A rental lasts whole days, counted from the payment.' };
    expect((await call('POST', '/staff/policies/terms', modToken, v2)).json().error.code).toBe('ADMINS_ONLY');
    expect((await call('POST', '/staff/policies/terms', person.accessToken, v2)).statusCode).toBe(403);
    const published = await call('POST', '/staff/policies/terms', boss.accessToken, v2);
    expect(published.statusCode).toBe(201);
    expect(published.json()).toMatchObject({ slug: 'terms', version: 2, summary: 'Rentals now last whole days.' });

    const mine = (await call('GET', '/me/policies', person.accessToken)).json();
    expect(mine.items.find((p: { slug: string }) => p.slug === 'terms')).toMatchObject({ version: 2, acceptedVersion: 1, accepted: false });
    expect((await call('GET', '/notifications', person.accessToken)).json().items[0]).toMatchObject({ type: 'policy.updated', title: 'We updated our terms of use' });

    const overview = (await call('GET', '/staff/policies', modToken)).json();
    const t2 = overview.items.find((p: { slug: string }) => p.slug === 'terms');
    expect(t2).toMatchObject({ version: 2, accepted: 0, publishedBy: `@${boss.handle}` });
    expect(t2.versions.map((v: { version: number; accepted: number }) => [v.version, v.accepted])).toEqual([
      [2, 0],
      [1, 1],
    ]);
    const { rows: log } = await t.app.ctx.db.query(`SELECT action, entity_id FROM core.audit_log WHERE action LIKE 'policy.%' ORDER BY id`);
    expect(log).toEqual([
      { action: 'policy.accepted', entity_id: 'terms@1' },
      { action: 'policy.published', entity_id: 'terms@2' },
    ]);
  });
});
