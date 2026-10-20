import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MlClient } from '../src/lib/ml.js';
import { BEHAVIOUR_FEATURES, scanBehaviour } from '../src/modules/accounts/behaviour.js';
import { auth, makeApp, signUp, uniq, type TestApp } from './helpers.js';

/** A stand-in for ALT's behaviour model: an account is unusual when it failed to sign in 3 or more times. */
let seen: { features: string[]; train: number[][]; score: number[][] } | null = null;
const fakeMl: MlClient = {
  model: 'fake',
  toxicity: async (texts) => texts.map(() => ({ level: 'none', categories: [], scores: {} })),
  embed: async () => null,
  async anomaly(features, train, score) {
    seen = { features, train, score };
    const failed = features.indexOf('failed_sign_ins');
    return {
      model: 'fake-forest',
      trained_rows: train.length,
      thresholds: { forest: 0.6, extreme: 3 },
      results: score.map((row) => (row[failed]! >= 3 ? { score: 0.8, extreme: 6, unusual: true, reasons: ['failed_sign_ins'] } : { score: 0.4, extreme: 0, unusual: false, reasons: [] })),
    };
  },
};

let t: TestApp;
const bossEmail = `boss_${uniq()}@alt.test`;
beforeAll(async () => {
  t = await makeApp({ ADMIN_EMAILS: bossEmail }, { ml: fakeMl });
});
afterAll(async () => {
  await t.app.close();
});

describe('abnormal-behaviour detection (Module 16 FE-3, with the behaviour model)', () => {
  it('counts each account from the audit log, flags unusual ones for staff, and shows the scan to staff only', async () => {
    const victim = await signUp(t);
    const calm = await signUp(t);
    for (let i = 0; i < 6; i++) {
      await t.app.inject({ method: 'POST', url: '/auth/login', payload: { identifier: victim.email, password: `wrong pass ${i}x`, platform: 'alter' } });
    }

    // No history in a test database, so the scan learns from whatever there is (the real minimum is 50 days).
    const scan = await scanBehaviour(t.app.ctx, new Date(), 0);
    expect(scan.status).toBe('done');
    expect(seen!.features).toEqual([...BEHAVIOUR_FEATURES]);
    const results = (await t.app.ctx.db.query('SELECT results FROM core.behaviour_scans WHERE id = $1', [scan.id])).rows[0].results as { userId: string; unusual: boolean; features: Record<string, number> }[];
    const v = results.find((r) => r.userId === victim.user.id)!;
    expect(v).toMatchObject({ unusual: true, features: { failed_sign_ins: expect.any(Number) } });
    // Four wrong passwords, then the fifth locks the account (counted as a lockout).
    expect(v.features).toMatchObject({ failed_sign_ins: 4, lockouts: 1 });
    expect(results.find((r) => r.userId === calm.user.id)?.unusual ?? false).toBe(false);

    // A flag case for staff; nothing is done to the account itself.
    const { rows: cases } = await t.app.ctx.db.query(`SELECT * FROM core.cases WHERE subject_type = 'user' AND subject_id = $1 AND category = 'unusual_activity'`, [victim.user.id]);
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({ kind: 'flag', status: 'open' });
    const { rows: opened } = await t.app.ctx.db.query(`SELECT data FROM core.case_events WHERE case_id = $1 AND kind = 'opened'`, [cases[0].id]);
    expect(opened[0].data.evidence).toMatchObject({ reasons: ['failed_sign_ins'], features: { failed_sign_ins: 4 } });
    expect((await t.app.ctx.db.query(`SELECT 1 FROM core.cases WHERE subject_id = $1 AND category = 'unusual_activity'`, [calm.user.id])).rows).toHaveLength(0);

    // Staff see the scan; people don't.
    expect((await t.app.inject({ method: 'GET', url: '/admin/behaviour', headers: auth(calm.accessToken) })).statusCode).toBe(403);
    const boss = await signUp(t, { email: bossEmail, platform: 'admin' });
    const view = (await t.app.inject({ method: 'GET', url: '/admin/behaviour', headers: auth(boss.accessToken) })).json();
    expect(view.scans[0]).toMatchObject({ id: String(scan.id), status: 'done', flagged: expect.any(Number) });
    expect(view.scans[0].results.find((r: { userId: string }) => r.userId === victim.user.id).user.handle).toBe(victim.handle);
  });

  it('says so instead of guessing when there is too little history or no ML service', async () => {
    expect((await scanBehaviour(t.app.ctx, new Date(), 1_000_000)).status).toBe('not_enough_data');
    expect((await scanBehaviour({ ...t.app.ctx, ml: null })).status).toBe('unavailable');
  });
});
