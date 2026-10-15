import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, makeApp, signUp, uniq, type TestApp } from './helpers.js';

let t: TestApp;
const bossEmail = `boss_${uniq()}@alt.test`;
let boss: Awaited<ReturnType<typeof signUp>>;
const service = { 'x-alt-service-key': 'test-internal-service-key-0123456789abcdef', 'x-alt-service': 'altera-api' };

beforeAll(async () => {
  t = await makeApp({ ADMIN_EMAILS: bossEmail });
  boss = await signUp(t, { email: bossEmail, platform: 'admin' });
});
afterAll(async () => {
  await t.app.close();
});

const login = async (u: { email: string; password: string }, platform = 'admin') =>
  (await t.app.inject({ method: 'POST', url: '/auth/login', payload: { identifier: u.email, password: u.password, platform } })).json().accessToken as string;

/** A person with a staff role, signed in to the portal. */
async function staffMember(role: 'moderator' | 'support' | 'auditor') {
  const u = await signUp(t);
  const res = await t.app.inject({ method: 'PUT', url: `/admin/users/${u.user.id}/roles`, headers: auth(boss.accessToken), payload: { roles: ['participant', role] } });
  expect(res.statusCode).toBe(200);
  return { ...u, token: await login(u) };
}

const inbox = async (token: string) => (await t.app.inject({ method: 'GET', url: '/notifications', headers: auth(token) })).json().items as { type: string; title: string; body: string }[];

describe('the ALT Portal case queue (M3)', () => {
  it('merges reports about the same thing into one case, from people and from services', async () => {
    const [a, b, c] = [await signUp(t, { platform: 'altera' }), await signUp(t, { platform: 'altera' }), await signUp(t)];
    const post = `post-${uniq()}`;
    const report = (token: string, body: string) =>
      t.app.inject({ method: 'POST', url: '/me/cases', headers: auth(token), payload: { kind: 'report', category: 'impersonation', title: 'Pretends to be human', body, subject: { type: 'post', id: post } } });

    const first = await report(a.accessToken, 'from A');
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ merged: false, case: { kind: 'report', platform: 'altera', status: 'open' } });
    expect((await report(b.accessToken, 'private note from B')).json().merged).toBe(true);
    // The same person reporting twice counts once.
    expect((await report(a.accessToken, 'again')).statusCode).toBe(200);
    // ALTERA files a third report for someone who used its own Report button.
    const viaService = await t.app.inject({
      method: 'POST',
      url: '/internal/cases',
      headers: service,
      payload: { kind: 'report', platform: 'altera', category: 'impersonation', title: 'Reported post', subject: { type: 'post', id: post }, reporterId: c.user.id, evidence: { content: 'I am totally human' } },
    });
    expect(viaService.json()).toMatchObject({ merged: true, duplicate: false, number: first.json().case.number });
    const { rows } = await t.app.ctx.db.query('SELECT reports, priority FROM core.cases WHERE id = $1', [first.json().case.id]);
    expect(rows[0]).toEqual({ reports: 3, priority: 'high' });

    // A reporter sees their own report, never another reporter's words.
    const mine = (await t.app.inject({ method: 'GET', url: `/me/cases/${first.json().case.id}`, headers: auth(a.accessToken) })).json();
    expect(mine.events.map((e: { body: string }) => e.body)).toEqual(['from A']);
    expect((await t.app.inject({ method: 'GET', url: '/me/cases', headers: auth(b.accessToken) })).json().items[0].id).toBe(first.json().case.id);

    // Automatic flags are their own cases; services need the key.
    const flag = await t.app.inject({ method: 'POST', url: '/internal/cases', headers: service, payload: { kind: 'flag', platform: 'altera', category: 'post_limit', title: 'AI posted 45 times today', subject: { type: 'post', id: post } } });
    expect(flag.statusCode).toBe(201);
    expect((await t.app.inject({ method: 'POST', url: '/internal/cases', payload: { kind: 'flag', platform: 'altera', category: 'x_y', title: 'nope' } })).statusCode).toBe(401);
  });

  it('lets staff see only their queues, only from a portal session', async () => {
    const someone = await signUp(t);
    const helpReq = await t.app.inject({ method: 'POST', url: '/me/cases', headers: auth(someone.accessToken), payload: { kind: 'support', category: 'billing', title: 'Charged twice', body: 'My rental was charged twice.' } });
    expect(helpReq.statusCode).toBe(201);
    expect((await inbox(someone.accessToken))[0]).toMatchObject({ type: 'case.received' });
    const helpId = helpReq.json().case.id;

    const mod = await staffMember('moderator');
    const sup = await staffMember('support');
    const aud = await staffMember('auditor');

    expect((await t.app.inject({ method: 'GET', url: '/staff/summary', headers: auth(someone.accessToken) })).statusCode).toBe(403);
    // A staff member's token from a phone app is not enough.
    const fromApp = await t.app.inject({ method: 'GET', url: '/staff/summary', headers: auth(await login(mod, 'altera')) });
    expect(fromApp.json().error.code).toBe('PORTAL_SESSION_REQUIRED');

    expect((await t.app.inject({ method: 'GET', url: '/staff/me', headers: auth(mod.token) })).json()).toMatchObject({ roles: ['moderator'], handles: ['report', 'flag', 'appeal'] });
    expect((await t.app.inject({ method: 'GET', url: `/staff/cases/${helpId}`, headers: auth(mod.token) })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'GET', url: `/staff/cases/${helpId}`, headers: auth(sup.token) })).statusCode).toBe(200);
    const queue = (await t.app.inject({ method: 'GET', url: '/staff/cases?kind=support', headers: auth(mod.token) })).json().items;
    expect(queue).toEqual([]);

    // Auditors read everything and change nothing.
    expect((await t.app.inject({ method: 'GET', url: `/staff/cases/${helpId}`, headers: auth(aud.token) })).statusCode).toBe(200);
    const audAssign = await t.app.inject({ method: 'POST', url: `/staff/cases/${helpId}/assign`, headers: auth(aud.token), payload: {} });
    expect(audAssign.json().error.code).toBe('NOT_YOUR_QUEUE');

    // Support answers; the person sees "ALT", replies, and the case comes back to the queue.
    await t.app.inject({ method: 'POST', url: `/staff/cases/${helpId}/assign`, headers: auth(sup.token), payload: {} });
    await t.app.inject({ method: 'POST', url: `/staff/cases/${helpId}/notes`, headers: auth(sup.token), payload: { body: 'Check the chain for two Rented events.' } });
    const reply = await t.app.inject({ method: 'POST', url: `/staff/cases/${helpId}/reply`, headers: auth(sup.token), payload: { body: 'Which AI did you rent?', waitForAnswer: true } });
    expect(reply.json().case).toMatchObject({ status: 'waiting', assignee: { id: sup.user.id } });
    expect((await inbox(someone.accessToken))[0]).toMatchObject({ type: 'case.reply', body: 'Which AI did you rent?' });
    await t.app.inject({ method: 'POST', url: `/me/cases/${helpId}/messages`, headers: auth(someone.accessToken), payload: { body: 'Urdu Ustad.' } });
    const view = (await t.app.inject({ method: 'GET', url: `/me/cases/${helpId}`, headers: auth(someone.accessToken) })).json();
    expect(view.case.status).toBe('open');
    expect(view.events.map((e: { from: string; body: string }) => [e.from, e.body])).toEqual([
      ['you', 'My rental was charged twice.'],
      ['alt', 'Which AI did you rent?'],
      ['you', 'Urdu Ustad.'],
    ]);

    const done = await t.app.inject({ method: 'POST', url: `/staff/cases/${helpId}/resolve`, headers: auth(sup.token), payload: { outcome: 'resolved', resolution: 'Refunded the second payment.' } });
    expect(done.json().case).toMatchObject({ status: 'resolved', resolution: 'Refunded the second payment.' });
    expect((await inbox(someone.accessToken))[0]).toMatchObject({ type: 'case.resolved', title: `#${done.json().case.number} is closed` });
    const late = await t.app.inject({ method: 'POST', url: `/me/cases/${helpId}/messages`, headers: auth(someone.accessToken), payload: { body: 'one more thing' } });
    expect(late.json().error.code).toBe('CASE_CLOSED');

    // Everything staff did is in the audit log, and the chain still checks out.
    const { rows } = await t.app.ctx.db.query(`SELECT action FROM core.audit_log WHERE entity_id = $1 ORDER BY id`, [helpId]);
    expect(rows.map((r) => r.action)).toEqual(['case.opened', 'case.assigned', 'case.noted', 'case.replied', 'case.resolved']);
    expect((await t.app.inject({ method: 'GET', url: '/admin/audit/verify', headers: auth(boss.accessToken) })).json().ok).toBe(true);

    // Choosing your own roles keeps a staff role.
    const keep = await t.app.inject({ method: 'PUT', url: '/me/roles', headers: auth(mod.accessToken), payload: { roles: ['creator'] } });
    expect(keep.json().roles.sort()).toEqual(['creator', 'moderator']);
  });

  it('tells every reporter the outcome, and keeps staff off cases that involve them', async () => {
    const mod = await staffMember('moderator');
    const reporter = await signUp(t, { platform: 'altera' });
    const target = await signUp(t);
    const about = { kind: 'report', category: 'harassment', title: 'Rude DMs', body: 'See the thread.', subject: { type: 'user', id: target.user.id } };
    const filed = (await t.app.inject({ method: 'POST', url: '/me/cases', headers: auth(reporter.accessToken), payload: about })).json().case;
    // The moderator reports the same person too; now they're involved and must not decide it.
    expect((await t.app.inject({ method: 'POST', url: '/me/cases', headers: auth(mod.accessToken), payload: about })).json().merged).toBe(true);
    const blocked = await t.app.inject({ method: 'POST', url: `/staff/cases/${filed.id}/resolve`, headers: auth(mod.token), payload: { outcome: 'dismissed', resolution: 'Nothing found.' } });
    expect(blocked.json().error.code).toBe('CONFLICT_OF_INTEREST');
    expect((await t.app.inject({ method: 'GET', url: `/staff/cases/${filed.id}`, headers: auth(mod.token) })).json().canHandle).toBe(false);

    const other = await staffMember('moderator');
    const decided = await t.app.inject({ method: 'POST', url: `/staff/cases/${filed.id}/resolve`, headers: auth(other.token), payload: { outcome: 'dismissed', resolution: 'Nothing found.' } });
    expect(decided.json().case.status).toBe('dismissed');
    const own = (await t.app.inject({ method: 'POST', url: '/me/cases', headers: auth(other.accessToken), payload: { ...about, subject: { type: 'post', id: `p-${uniq()}` } } })).json().case;
    const self = await t.app.inject({ method: 'POST', url: `/staff/cases/${own.id}/assign`, headers: auth(other.token), payload: {} });
    expect(self.json().error.code).toBe('CONFLICT_OF_INTEREST');

    expect((await inbox(reporter.accessToken))[0]).toMatchObject({ type: 'case.dismissed', title: `Your report #${filed.number} was reviewed`, body: 'Nothing found.' });
    expect((await inbox(mod.accessToken))[0]).toMatchObject({ type: 'case.dismissed' });
  });

  it('can require 2FA for staff', async () => {
    const strict = await makeApp({ ADMIN_EMAILS: bossEmail, STAFF_REQUIRE_2FA: 'true' });
    try {
      const res = await strict.app.inject({ method: 'GET', url: '/staff/summary', headers: auth(boss.accessToken) });
      expect(res.json().error.code).toBe('STAFF_2FA_REQUIRED');
    } finally {
      await strict.app.close();
    }
  });
});
