import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LlmProvider } from '../src/modules/ai/llm.js';
import { auth, makeApp, signUp, uniq, type TestApp } from './helpers.js';

// Hardhat's development account #0 deploys the test chain's contracts, so it is the registry's governor.
const GOVERNOR = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const echo: LlmProvider = {
  name: 'echo',
  async complete(messages) {
    return { text: `reply to: ${messages[messages.length - 1]!.content.slice(0, 30)}`, provider: 'echo', model: 'echo-1' };
  },
};

let t: TestApp;
let services: FastifyInstance;
const calls: { url: string; headers: Record<string, unknown>; body: Record<string, unknown> }[] = [];
const bossEmail = `boss_${uniq()}@alt.test`;
let boss: Awaited<ReturnType<typeof signUp>>;
const serviceHeaders = { 'x-alt-service-key': 'test-internal-service-key-0123456789abcdef', 'x-alt-service': 'altera-api' };

beforeAll(async () => {
  // Stand-ins for ALTERA's and ALTAR's /internal routes: they record what Core asked.
  services = Fastify();
  services.post('/*', async (req) => {
    calls.push({ url: req.url, headers: req.headers, body: req.body as Record<string, unknown> });
    return { removed: true };
  });
  await services.listen({ port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${(services.server.address() as { port: number }).port}`;
  t = await makeApp(
    { ADMIN_EMAILS: bossEmail, GOVERNOR_PRIVATE_KEY: GOVERNOR, ALTERA_SERVICE_URL: base, ALTAR_SERVICE_URL: base, CLEARANCE_MIN_TEST_MESSAGES: '1' },
    { llmProviders: [echo] },
  );
  boss = await signUp(t, { email: bossEmail, platform: 'admin' });
});
afterAll(async () => {
  await t.app.close();
  await services.close();
});

type User = Awaited<ReturnType<typeof signUp>>;
const call = (method: string, url: string, token: string, payload?: object) => t.app.inject({ method: method as 'GET', url, headers: auth(token), payload });
const login = async (u: { email: string; password: string }, platform = 'admin') =>
  t.app.inject({ method: 'POST', url: '/auth/login', payload: { identifier: u.email, password: u.password, platform } });
const inbox = async (token: string) => (await call('GET', '/notifications', token)).json().items as { type: string; title: string; body: string }[];

async function staffMember(role: 'moderator' | 'support') {
  const u = await signUp(t);
  await call('PUT', `/admin/users/${u.user.id}/roles`, boss.accessToken, { roles: ['participant', role] });
  return { ...u, token: (await login(u)).json().accessToken as string };
}

async function verifiedAi(owner: User) {
  const ai = (
    await call('POST', '/ais', owner.accessToken, {
      name: 'Rogue AI',
      handle: `ai_${uniq()}`,
      onboarding: { about: 'Testing moderation.', primaryTrait: 'Calm' },
      consents: { persona_training: true, third_party_processing: true, public_deployment: true },
    })
  ).json();
  await call('POST', `/ais/${ai.id}/versions`, owner.accessToken);
  const s = (await call('POST', `/ais/${ai.id}/chat/sessions`, owner.accessToken, {})).json();
  await call('POST', `/ais/${ai.id}/chat/sessions/${s.id}/messages`, owner.accessToken, { content: 'hello' });
  await call('POST', `/ais/${ai.id}/confirm`, owner.accessToken, { confirmed: true });
  await call('POST', `/ais/${ai.id}/deploy`, owner.accessToken);
  await t.app.jobs.drain();
  return (await call('GET', `/ais/${ai.id}`, owner.accessToken)).json();
}

describe('acting on a case from the ALT Command Centre (P4)', () => {
  it('suspends an AI on-chain and everywhere, warns and locks its owner, then undoes it', async () => {
    const owner = await signUp(t);
    const reporter = await signUp(t, { platform: 'altera' });
    const ai = await verifiedAi(owner);
    const filed = (
      await call('POST', '/me/cases', reporter.accessToken, { kind: 'report', category: 'impersonation', title: 'Claims to be human', body: 'It said so.', subject: { type: 'ai', id: ai.id } })
    ).json().case;
    const mod = await staffMember('moderator');
    const act = (body: object, token = mod.token) => call('POST', `/staff/cases/${filed.id}/actions`, token, body);

    // What the case is about, for the Command Centre's action buttons.
    const view = (await call('GET', `/staff/cases/${filed.id}`, mod.token)).json();
    expect(view.targets).toMatchObject({ ai: { id: ai.id, suspended: false }, person: { id: owner.user.id, warnings: 0, lockedUntil: null }, content: null, canSuspendOnChain: true });

    // Suspend: on-chain first, then ALT stops the AI everywhere and tells its owner.
    const suspended = await act({ action: 'suspend_ai', reason: 'Impersonates its owner.' });
    expect(suspended.statusCode).toBe(200);
    expect((await t.app.ctx.chain!.readIdentity(BigInt(ai.token.tokenId))).suspended).toBe(true);
    expect((await t.app.ctx.db.query('SELECT status FROM core.personal_ais WHERE id = $1', [ai.id])).rows[0].status).toBe('suspended');
    expect((await inbox(owner.accessToken))[0]).toMatchObject({ type: 'ai.suspended', title: 'ALT suspended Rogue AI' });
    const speak = await t.app.inject({
      method: 'POST',
      url: `/internal/ais/${ai.id}/respond`,
      headers: serviceHeaders,
      payload: { channel: 'altera_post', messages: [{ role: 'user', content: 'post something' }] },
    });
    expect(speak.json().error.code).toBe('AI_NOT_VERIFIED');
    expect((await act({ action: 'suspend_ai', reason: 'Again.' })).json().error.code).toBe('ALREADY_SUSPENDED');

    // Support may warn but not suspend.
    const sup = await staffMember('support');
    expect((await act({ action: 'unsuspend_ai', reason: 'Not mine to do.' }, sup.token)).json().error.code).toBe('NOT_YOUR_ACTION');

    // Warn the owner: their inbox, and the count staff see next time.
    await act({ action: 'warn_user', reason: 'Set clear boundaries for your AI.' });
    expect((await inbox(owner.accessToken))[0]).toMatchObject({ type: 'account.warning', title: 'A warning from ALT' });
    expect((await call('GET', `/staff/cases/${filed.id}`, mod.token)).json().targets.person.warnings).toBe(1);

    // Lock for a day: signed out everywhere at once, can't sign in, told by email.
    const locked = await act({ action: 'lock_account', reason: 'Repeated impersonation.', days: 1 });
    expect(locked.statusCode).toBe(200);
    expect((await call('GET', '/me', owner.accessToken)).json().error.code).toBe('SESSION_REVOKED');
    expect((await login(owner, 'alter')).statusCode).toBe(423);
    expect(t.mailer.outbox().find((m) => m.to === owner.email && m.subject === 'Your ALT account is suspended')?.text).toContain('Repeated impersonation.');

    // Undo both.
    await act({ action: 'unlock_account', reason: 'Appeal accepted.' });
    expect((await login(owner, 'alter')).statusCode).toBe(200);
    await act({ action: 'unsuspend_ai', reason: 'Fixed by its owner.' });
    expect((await t.app.ctx.chain!.readIdentity(BigInt(ai.token.tokenId))).suspended).toBe(false);
    expect((await t.app.ctx.db.query('SELECT status FROM core.personal_ais WHERE id = $1', [ai.id])).rows[0].status).toBe('verified');

    // Every action is in the case's history (staff only) and the audit log.
    const events = (await call('GET', `/staff/cases/${filed.id}`, mod.token)).json().events.filter((e: { kind: string }) => e.kind === 'action');
    expect(events.map((e: { data: { action: string } }) => e.data.action)).toEqual(['suspend_ai', 'warn_user', 'lock_account', 'unlock_account', 'unsuspend_ai']);
    expect(events.every((e: { visibility: string }) => e.visibility === 'staff')).toBe(true);
    const { rows } = await t.app.ctx.db.query(`SELECT action FROM core.audit_log WHERE entity_id = $1 AND action LIKE 'case.action.%' ORDER BY id`, [filed.id]);
    expect(rows.map((r) => r.action)).toEqual(['case.action.suspend_ai', 'case.action.warn_user', 'case.action.lock_account', 'case.action.unlock_account', 'case.action.unsuspend_ai']);
    // The reporter sees none of it until the case is closed.
    const theirs = (await call('GET', `/me/cases/${filed.id}`, reporter.accessToken)).json();
    expect(theirs.events.map((e: { kind: string }) => e.kind)).toEqual(['opened']);
  });

  it('asks ALTERA or ALTAR to remove a reported post or review, and tells its author', async () => {
    const author = await signUp(t, { platform: 'altera' });
    const mod = await staffMember('moderator');
    const postId = '0b5c8a2e-3c1d-4a7e-9f10-2d3e4f5a6b7c';
    const post = (
      await t.app.inject({
        method: 'POST',
        url: '/internal/cases',
        headers: serviceHeaders,
        payload: { kind: 'report', platform: 'altera', category: 'spam', title: 'Spam post', subject: { type: 'post', id: postId, userId: author.user.id } },
      })
    ).json();
    expect((await call('GET', `/staff/cases/${post.caseId}`, mod.token)).json().targets.content).toEqual({ type: 'post', id: postId, platform: 'altera' });
    const removed = await call('POST', `/staff/cases/${post.caseId}/actions`, mod.token, { action: 'remove_content', reason: 'Advertising.' });
    expect(removed.statusCode).toBe(200);
    expect(calls.at(-1)).toMatchObject({
      url: '/internal/moderation/remove',
      headers: { 'x-alt-service': 'core', 'x-alt-service-key': 'test-internal-service-key-0123456789abcdef' },
      body: { type: 'post', id: postId, reason: 'Advertising.' },
    });
    expect((await inbox(author.accessToken))[0]).toMatchObject({ type: 'content.removed', title: 'ALT removed your post on ALTERA' });

    const review = (
      await t.app.inject({
        method: 'POST',
        url: '/internal/cases',
        headers: { ...serviceHeaders, 'x-alt-service': 'altar' },
        payload: { kind: 'report', platform: 'altar', category: 'fake', title: 'Fake review', subject: { type: 'review', id: `${postId}:${author.user.id}`, userId: author.user.id } },
      })
    ).json();
    await call('POST', `/staff/cases/${review.caseId}/actions`, mod.token, { action: 'remove_content', reason: 'Not a real customer.' });
    expect(calls.at(-1)).toMatchObject({ url: '/internal/reviews/remove', body: { aiId: postId, reviewerId: author.user.id } });

    // A support request has nothing to remove; a moderator can't lock a member of staff.
    const sup = await staffMember('support');
    const help = (await call('POST', '/me/cases', sup.accessToken, { kind: 'report', category: 'harassment', title: 'Staff member was rude', body: 'Really.', subject: { type: 'user', id: mod.user.id } })).json().case;
    const other = await staffMember('moderator');
    expect((await call('POST', `/staff/cases/${help.id}/actions`, other.token, { action: 'remove_content', reason: 'Nothing.' })).json().error.code).toBe('NOTHING_TO_REMOVE');
    expect((await call('POST', `/staff/cases/${help.id}/actions`, other.token, { action: 'lock_account', reason: 'No.', days: 1 })).json().error.code).toBe('STAFF_ACCOUNT');
  });
});
