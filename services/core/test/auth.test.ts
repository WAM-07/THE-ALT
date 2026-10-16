import { createLocalJWKSet, jwtVerify } from 'jose';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createSiweMessage } from 'viem/siwe';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { base32Decode, currentStep, hotp } from '../src/lib/totp.js';
import { ADMIN_EMAIL, auth, lastCode, makeApp, signUp, uniq, type TestApp } from './helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await makeApp();
});
afterAll(async () => {
  await t.app.close();
});

const post = (url: string, payload?: object, headers?: Record<string, string>) =>
  t.app.inject({ method: 'POST', url, payload, headers });
const get = (url: string, headers?: Record<string, string>) => t.app.inject({ method: 'GET', url, headers });

describe('registration and email verification', () => {
  it('creates one account with a custodial wallet and signs in after the email code', async () => {
    const u = await signUp(t);
    expect(u.accessToken).toBeTruthy();
    expect(u.user.wallets).toHaveLength(1);
    expect(u.user.wallets[0]).toMatchObject({ kind: 'custodial', isPrimary: true });
    expect(u.user.wallets[0]!.address).toMatch(/^0x[0-9a-f]{40}$/);

    const me = await get('/me', auth(u.accessToken));
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ email: u.email, emailVerified: true, roles: ['participant'] });
    expect(me.json().platforms.map((p: { platform: string }) => p.platform)).toEqual(['alter']);
  });

  it('rejects duplicate emails and handles', async () => {
    const u = await signUp(t);
    const dupEmail = await post('/auth/register', { email: u.email, password: 'another pass 1', handle: `x_${uniq()}`, displayName: 'X' });
    expect(dupEmail.statusCode).toBe(409);
    expect(dupEmail.json().error.code).toBe('EMAIL_TAKEN');
    const dupHandle = await post('/auth/register', { email: `n_${uniq()}@alt.test`, password: 'another pass 1', handle: u.handle, displayName: 'X' });
    expect(dupHandle.json().error.code).toBe('HANDLE_TAKEN');
  });

  it('refuses weak passwords', async () => {
    const res = await post('/auth/register', { email: `w_${uniq()}@alt.test`, password: 'short', handle: `w_${uniq()}`, displayName: 'W' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('blocks sign-in until the email is verified', async () => {
    const email = `nv_${uniq()}@alt.test`;
    await post('/auth/register', { email, password: 'good pass 123', handle: `nv_${uniq()}`, displayName: 'NV' });
    const res = await post('/auth/login', { identifier: email, password: 'good pass 123', platform: 'altera' });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('kills a code after 5 wrong attempts', async () => {
    const email = `otp_${uniq()}@alt.test`;
    await post('/auth/register', { email, password: 'good pass 123', handle: `otp_${uniq()}`, displayName: 'O' });
    const real = lastCode(t, email);
    const wrong = real === '000000' ? '111111' : '000000';
    for (let i = 0; i < 4; i++) {
      expect((await post('/auth/email/verify', { email, code: wrong, platform: 'alter' })).json().error.code).toBe('OTP_INVALID');
    }
    expect((await post('/auth/email/verify', { email, code: wrong, platform: 'alter' })).json().error.code).toBe('OTP_TOO_MANY_ATTEMPTS');
    expect((await post('/auth/email/verify', { email, code: real, platform: 'alter' })).statusCode).toBe(400);
  });
});

describe('password sign-in', () => {
  it('signs in by email or handle and records the platform', async () => {
    const u = await signUp(t);
    const byHandle = await post('/auth/login', { identifier: u.handle.toUpperCase(), password: u.password, platform: 'altera' });
    expect(byHandle.statusCode).toBe(200);
    const platforms = byHandle.json().user.platforms.map((p: { platform: string }) => p.platform).sort();
    expect(platforms).toEqual(['alter', 'altera']);
  });

  it('gives the same error for unknown accounts and wrong passwords', async () => {
    const u = await signUp(t);
    const wrong = await post('/auth/login', { identifier: u.email, password: 'nope nope 1', platform: 'alter' });
    const unknown = await post('/auth/login', { identifier: `ghost_${uniq()}@alt.test`, password: 'nope nope 1', platform: 'alter' });
    expect(wrong.json().error.code).toBe('INVALID_CREDENTIALS');
    expect(unknown.json().error.code).toBe('INVALID_CREDENTIALS');
  });

  it('locks the account for 30 minutes after 5 failures, even for the right password', async () => {
    const u = await signUp(t);
    for (let i = 0; i < 4; i++) {
      expect((await post('/auth/login', { identifier: u.email, password: 'bad pass 1', platform: 'alter' })).statusCode).toBe(401);
    }
    const fifth = await post('/auth/login', { identifier: u.email, password: 'bad pass 1', platform: 'alter' });
    expect(fifth.statusCode).toBe(423);
    const right = await post('/auth/login', { identifier: u.email, password: u.password, platform: 'alter' });
    expect(right.statusCode).toBe(423);
    expect(right.json().error.details.lockedUntil).toBeTruthy();
  });
});

describe('sessions', () => {
  it('rotates refresh tokens and revokes the session when an old one is replayed', async () => {
    const u = await signUp(t);
    const first = await post('/auth/refresh', { refreshToken: u.refreshToken });
    expect(first.statusCode).toBe(200);
    const next = first.json().refreshToken as string;
    expect(next).not.toBe(u.refreshToken);

    const replay = await post('/auth/refresh', { refreshToken: u.refreshToken });
    expect(replay.statusCode).toBe(401);
    expect(replay.json().error.code).toBe('REFRESH_TOKEN_REUSED');
    // The thief's replay also kills the legitimate token.
    expect((await post('/auth/refresh', { refreshToken: next })).statusCode).toBe(401);
  });

  it('logout ends the session immediately; logout-all ends every app', async () => {
    const u = await signUp(t);
    const other = (await post('/auth/login', { identifier: u.email, password: u.password, platform: 'altar' })).json();
    expect((await post('/auth/logout', undefined, auth(u.accessToken))).statusCode).toBe(200);
    const after = await get('/me', auth(u.accessToken));
    expect(after.statusCode).toBe(401);
    expect(after.json().error.code).toBe('SESSION_REVOKED');
    expect((await get('/me', auth(other.accessToken))).statusCode).toBe(200);

    const third = (await post('/auth/login', { identifier: u.email, password: u.password, platform: 'altera' })).json();
    const all = await post('/auth/logout-all', undefined, auth(third.accessToken));
    expect(all.json().sessionsRevoked).toBe(2);
    expect((await get('/me', auth(other.accessToken))).statusCode).toBe(401);
  });

  it('lists devices and revokes one', async () => {
    const u = await signUp(t);
    const second = (await post('/auth/login', { identifier: u.email, password: u.password, platform: 'altera', deviceName: 'Pixel 8' })).json();
    const list = (await get('/me/sessions', auth(u.accessToken))).json();
    expect(list).toHaveLength(2);
    const pixel = list.find((s: { deviceName: string }) => s.deviceName === 'Pixel 8');
    const del = await t.app.inject({ method: 'DELETE', url: `/me/sessions/${pixel.id}`, headers: auth(u.accessToken) });
    expect(del.statusCode).toBe(200);
    expect((await get('/me', auth(second.accessToken))).statusCode).toBe(401);
  });

  it('issues RS256 tokens that verify against the published JWKS', async () => {
    const u = await signUp(t);
    const jwks = (await get('/.well-known/jwks.json')).json();
    const { payload } = await jwtVerify(u.accessToken, createLocalJWKSet(jwks), { audience: 'alt', issuer: 'http://localhost:8080/core' });
    expect(payload.sub).toBe(u.user.id);
    expect(payload.plat).toBe('alter');
  });
});

describe('moving between ALT apps (handoff)', () => {
  it('signs the same user into the target app once, with no password', async () => {
    const u = await signUp(t, { platform: 'alter' });
    const h = await post('/auth/handoff', { target: 'altera' }, auth(u.accessToken));
    expect(h.statusCode).toBe(200);
    expect(h.json().url).toMatch(/^altera:\/\/handoff\?code=/);

    const wrongApp = await post('/auth/handoff/redeem', { code: h.json().code, platform: 'altar' });
    expect(wrongApp.statusCode).toBe(401);

    // The receiving app can ask whose account it is before using the code (the code stays valid).
    expect((await post('/auth/handoff/peek', { code: h.json().code, platform: 'altar' })).statusCode).toBe(401);
    const peek = await post('/auth/handoff/peek', { code: h.json().code, platform: 'altera' });
    expect(peek.json()).toMatchObject({ handle: u.handle, displayName: expect.any(String) });
    const ok = await post('/auth/handoff/redeem', { code: h.json().code, platform: 'altera', deviceName: 'Phone' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user.id).toBe(u.user.id);

    const again = await post('/auth/handoff/redeem', { code: h.json().code, platform: 'altera' });
    expect(again.json().error.code).toBe('HANDOFF_INVALID');
  });
});

describe('web sessions keep their own cookies', () => {
  it('gives the ALT Command Centre a cookie of its own, so it never replaces an ALTAR session in the same browser', async () => {
    const u = await signUp(t, { platform: 'altar' });
    const cookieOf = (res: { headers: Record<string, unknown> }, name: string) => {
      const all = ([] as string[]).concat((res.headers['set-cookie'] as string | string[] | undefined) ?? []);
      return all.find((c) => c.startsWith(`${name}=`))?.split(';')[0]?.split('=')[1];
    };
    // ALTAR (the site) and the Command Centre sign in through handoffs, as web clients.
    const handoff = async (target: string) => (await post('/auth/handoff', { target }, auth(u.accessToken))).json().code;
    const altar = await post('/auth/handoff/redeem', { code: await handoff('altar'), platform: 'altar', client: 'web' });
    const cmd = await post('/auth/handoff/redeem', { code: await handoff('admin'), platform: 'admin', client: 'web' });
    const altarCookie = cookieOf(altar, 'alt_rt');
    const cmdCookie = cookieOf(cmd, 'alt_rt_cmd');
    expect(altarCookie).toBeTruthy();
    expect(cmdCookie).toBeTruthy();
    expect(cookieOf(cmd, 'alt_rt')).toBeUndefined();
    expect(cmd.json().refreshToken).toBeUndefined();

    // Each refreshes from its own cookie, and stays its own platform.
    const refreshCmd = await t.app.inject({ method: 'POST', url: '/auth/refresh', payload: { platform: 'admin' }, cookies: { alt_rt: altarCookie!, alt_rt_cmd: cmdCookie! } });
    expect(refreshCmd.statusCode).toBe(200);
    const nextCmd = cookieOf(refreshCmd, 'alt_rt_cmd');
    expect(nextCmd).toBeTruthy();
    const refreshAltar = await t.app.inject({ method: 'POST', url: '/auth/refresh', payload: {}, cookies: { alt_rt: altarCookie!, alt_rt_cmd: nextCmd! } });
    expect(refreshAltar.statusCode).toBe(200);
    expect(cookieOf(refreshAltar, 'alt_rt')).toBeTruthy();
    // The Command Centre's cookie alone doesn't refresh ALTAR.
    expect((await t.app.inject({ method: 'POST', url: '/auth/refresh', payload: {}, cookies: { alt_rt_cmd: nextCmd! } })).statusCode).toBe(401);

    // Signing out of the Command Centre clears only its cookie.
    const out = await t.app.inject({ method: 'POST', url: '/auth/logout', headers: auth(refreshCmd.json().accessToken) });
    const cleared = ([] as string[]).concat((out.headers['set-cookie'] as string | string[]) ?? []);
    expect(cleared.some((c) => c.startsWith('alt_rt_cmd=;'))).toBe(true);
    expect(cleared.some((c) => c.startsWith('alt_rt=;'))).toBe(false);
  });
});

describe('two-factor authentication', () => {
  it('requires a TOTP code at sign-in, rejects replays and accepts a recovery code once', async () => {
    const u = await signUp(t);
    const setup = (await post('/auth/2fa/setup', undefined, auth(u.accessToken))).json();
    expect(setup.otpauthUrl).toContain('otpauth://totp/');
    const secret = base32Decode(setup.secret);
    const step = currentStep();
    const enable = await post('/auth/2fa/enable', { code: hotp(secret, step) }, auth(u.accessToken));
    expect(enable.statusCode).toBe(200);
    const recovery: string[] = enable.json().recoveryCodes;
    expect(recovery).toHaveLength(8);

    const login = (await post('/auth/login', { identifier: u.email, password: u.password, platform: 'alter' })).json();
    expect(login.mfaRequired).toBe(true);
    expect(login.accessToken).toBeUndefined();

    const replay = await post('/auth/login/2fa', { mfaToken: login.mfaToken, code: hotp(secret, step) });
    expect(replay.json().error.code).toBe('MFA_CODE_INVALID');
    const ok = await post('/auth/login/2fa', { mfaToken: login.mfaToken, code: hotp(secret, step + 1) });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().accessToken).toBeTruthy();

    const viaRecovery = await post('/auth/login/2fa', { mfaToken: login.mfaToken, recoveryCode: recovery[0] });
    expect(viaRecovery.statusCode).toBe(200);
    const reused = await post('/auth/login/2fa', { mfaToken: login.mfaToken, recoveryCode: recovery[0] });
    expect(reused.statusCode).toBe(401);
  });
});

describe('passwords', () => {
  it('reset by email code signs out every device', async () => {
    const u = await signUp(t);
    expect((await post('/auth/password/forgot', { email: u.email })).json()).toEqual({ sent: true });
    const res = await post('/auth/password/reset', { email: u.email, code: lastCode(t, u.email), newPassword: 'brand new pass 9' });
    expect(res.statusCode).toBe(200);
    expect((await get('/me', auth(u.accessToken))).statusCode).toBe(401);
    expect((await post('/auth/login', { identifier: u.email, password: 'brand new pass 9', platform: 'alter' })).statusCode).toBe(200);
  });

  it('forgot-password answers the same for unknown emails', async () => {
    expect((await post('/auth/password/forgot', { email: `nobody_${uniq()}@alt.test` })).json()).toEqual({ sent: true });
  });

  it('change needs the current password and keeps only this session', async () => {
    const u = await signUp(t);
    const other = (await post('/auth/login', { identifier: u.email, password: u.password, platform: 'altera' })).json();
    expect((await post('/auth/password/change', { currentPassword: 'wrong pass 1', newPassword: 'next pass 22' }, auth(u.accessToken))).statusCode).toBe(401);
    const ok = await post('/auth/password/change', { currentPassword: u.password, newPassword: 'next pass 22' }, auth(u.accessToken));
    expect(ok.json().otherSessionsRevoked).toBe(1);
    expect((await get('/me', auth(u.accessToken))).statusCode).toBe(200);
    expect((await get('/me', auth(other.accessToken))).statusCode).toBe(401);
  });
});

describe('Google sign-in', () => {
  it('creates an account on first use and signs in to the same one later', async () => {
    const id = uniq();
    const token = JSON.stringify({ sub: `g-${id}`, email: `g_${id}@gmail.test`, emailVerified: true, name: 'Gee User', picture: null });
    const first = await post('/auth/google', { idToken: token, platform: 'altera' });
    expect(first.statusCode).toBe(200);
    expect(first.json().user).toMatchObject({ email: `g_${id}@gmail.test`, emailVerified: true, hasPassword: false });
    const second = await post('/auth/google', { idToken: token, platform: 'alter' });
    expect(second.json().user.id).toBe(first.json().user.id);
  });

  it('claims an unverified account with the same email and drops its unproven password', async () => {
    const id = uniq();
    const email = `claim_${id}@alt.test`;
    await post('/auth/register', { email, password: 'attacker pass 1', handle: `cl_${id}`, displayName: 'Squatter' });
    const res = await post('/auth/google', {
      idToken: JSON.stringify({ sub: `g-${id}`, email, emailVerified: true, name: 'Owner', picture: null }),
      platform: 'alter',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.hasPassword).toBe(false);
    expect((await post('/auth/login', { identifier: email, password: 'attacker pass 1', platform: 'alter' })).statusCode).toBe(401);
  });

  it('refuses Google accounts whose email is not verified', async () => {
    const res = await post('/auth/google', {
      idToken: JSON.stringify({ sub: `g-${uniq()}`, email: `u_${uniq()}@gmail.test`, emailVerified: false, name: null, picture: null }),
      platform: 'alter',
    });
    expect(res.json().error.code).toBe('GOOGLE_EMAIL_UNVERIFIED');
  });
});

describe('wallets and Sign-In With Ethereum', () => {
  async function siweMessage(nonceUrl: string, address: `0x${string}`, headers?: Record<string, string>) {
    const n = headers ? (await post(nonceUrl, undefined, headers)).json() : (await get(nonceUrl)).json();
    return createSiweMessage({ domain: n.domain, address, statement: n.statement, uri: n.uri, version: '1', chainId: 80002, nonce: n.nonce });
  }

  it('signs up with a wallet, then signs in to the same account with it', async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const message = await siweMessage('/auth/siwe/nonce', account.address);
    const signature = await account.signMessage({ message });
    const first = await post('/auth/siwe/login', { message, signature, platform: 'altar' });
    expect(first.statusCode).toBe(200);
    const primary = first.json().user.wallets.find((w: { isPrimary: boolean }) => w.isPrimary);
    expect(primary).toMatchObject({ kind: 'external', address: account.address.toLowerCase() });

    const replay = await post('/auth/siwe/login', { message, signature, platform: 'altar' });
    expect(replay.json().error.code).toBe('SIWE_NONCE_INVALID');

    const message2 = await siweMessage('/auth/siwe/nonce', account.address);
    const again = await post('/auth/siwe/login', { message: message2, signature: await account.signMessage({ message: message2 }), platform: 'altar' });
    expect(again.json().user.id).toBe(first.json().user.id);
  });

  it('rejects a signature from a different wallet', async () => {
    const claimed = privateKeyToAccount(generatePrivateKey());
    const signer = privateKeyToAccount(generatePrivateKey());
    const message = await siweMessage('/auth/siwe/nonce', claimed.address);
    const res = await post('/auth/siwe/login', { message, signature: await signer.signMessage({ message }), platform: 'altar' });
    expect(res.json().error.code).toBe('SIWE_SIGNATURE_INVALID');
  });

  it('links a wallet to an existing account, makes it primary, and refuses it for anyone else', async () => {
    const a = await signUp(t);
    const b = await signUp(t);
    const wallet = privateKeyToAccount(generatePrivateKey());
    const msg = await siweMessage('/me/wallets/nonce', wallet.address, auth(a.accessToken));
    const linked = await post('/me/wallets/link', { message: msg, signature: await wallet.signMessage({ message: msg }), makePrimary: true }, auth(a.accessToken));
    expect(linked.statusCode).toBe(200);
    expect(linked.json().find((w: { isPrimary: boolean }) => w.isPrimary).address).toBe(wallet.address.toLowerCase());

    const msgB = await siweMessage('/me/wallets/nonce', wallet.address, auth(b.accessToken));
    const stolen = await post('/me/wallets/link', { message: msgB, signature: await wallet.signMessage({ message: msgB }) }, auth(b.accessToken));
    expect(stolen.json().error.code).toBe('WALLET_IN_USE');

    const unlink = await t.app.inject({ method: 'DELETE', url: `/me/wallets/${wallet.address}`, headers: auth(a.accessToken) });
    expect(unlink.statusCode).toBe(200);
    expect(unlink.json()).toEqual([expect.objectContaining({ kind: 'custodial', isPrimary: true })]);
  });
});

describe('profile, directory and admin', () => {
  it('updates the profile everywhere and exposes a public view', async () => {
    const u = await signUp(t);
    const newHandle = `n_${uniq()}`;
    const res = await t.app.inject({
      method: 'PATCH',
      url: '/me',
      headers: auth(u.accessToken),
      payload: { displayName: 'New Name', handle: newHandle, bio: 'hello' },
    });
    expect(res.json()).toMatchObject({ displayName: 'New Name', handle: newHandle, bio: 'hello' });
    const pub = (await get(`/users/${newHandle}`)).json();
    expect(pub).toMatchObject({ handle: newHandle, displayName: 'New Name' });
    expect(pub.email).toBeUndefined();
    expect((await get(`/handles/${newHandle}/available`)).json().available).toBe(false);
  });

  it('accepts avatars hosted by ALT services but not arbitrary URLs', async () => {
    const u = await signUp(t);
    const patch = (avatarUrl: string) =>
      t.app.inject({ method: 'PATCH', url: '/me', headers: auth(u.accessToken), payload: { avatarUrl } });
    const ok = await patch('http://localhost:8080/altera/media/0b5f9a1e-2c3d-4e5f-8a9b-0c1d2e3f4a5b');
    expect(ok.statusCode).toBe(200);
    expect(ok.json().avatarUrl).toBe('http://localhost:8080/altera/media/0b5f9a1e-2c3d-4e5f-8a9b-0c1d2e3f4a5b');
    expect((await patch('https://tracker.example.com/pixel.png')).json().error.code).toBe('AVATAR_URL_NOT_ALLOWED');
  });

  it('lets services look users up only with the service key', async () => {
    const u = await signUp(t);
    const denied = await post('/internal/users/lookup', { ids: [u.user.id] });
    expect(denied.statusCode).toBe(401);
    const ok = await post('/internal/users/lookup', { ids: [u.user.id] }, { 'x-alt-service': 'altera', 'x-alt-service-key': t.config.internalServiceKey });
    expect(ok.json()[0].id).toBe(u.user.id);
  });

  it('keeps an intact, verifiable audit chain that only admins can read', async () => {
    const normal = await signUp(t);
    expect((await get('/admin/audit/verify', auth(normal.accessToken))).statusCode).toBe(403);
    let admin;
    try {
      admin = await signUp(t, { email: ADMIN_EMAIL });
    } catch {
      admin = { accessToken: (await post('/auth/login', { identifier: ADMIN_EMAIL, password: 'correct horse 1', platform: 'admin' })).json().accessToken };
    }
    const verify = await get('/admin/audit/verify', auth(admin.accessToken));
    expect(verify.statusCode).toBe(200);
    expect(verify.json().ok).toBe(true);
    expect(verify.json().checked).toBeGreaterThan(10);
  });
});

describe('request bodies', () => {
  it('accepts body-less POSTs that still say content-type: application/json', async () => {
    const u = await signUp(t);
    const res = await t.app.inject({ method: 'POST', url: '/auth/logout', headers: { ...auth(u.accessToken), 'content-type': 'application/json' }, payload: '' });
    expect(res.statusCode).toBe(200);
  });

  it('rejects malformed JSON with a clear error', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/auth/login', headers: { 'content-type': 'application/json' }, payload: '{nope' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_JSON');
  });
});
