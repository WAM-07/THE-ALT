// ALT Account window. ALTER, ALTERA and ALTAR open it ("Continue with ALT") instead of keeping
// their own sign-in forms. It signs the person in (or registers them) with ALT Core, asks Core for a
// one-time handoff code for the platform that opened it, signs this short window session out again,
// and hands the code back:
//   return=popup  : postMessage to the opener (same origin only), then close;
//   return=app    : open the app's own link (alter://handoff?code=… / altera://…);
//   return=redirect (default): go to the platform's handoff page.
// The platform redeems the code for its own session, so it never sees the password.
//
// mode=confirm (ALTAR, return=popup): confirms one spend from the ALT wallet. The opener lends its
// session (a same-origin message), the person types their password or 2FA code here, and Core
// returns a one-time approval bound to exactly what is shown, which goes back to the opener.
(() => {
  'use strict';

  const PLATFORMS = { alter: 'ALTER', altera: 'ALTERA', altar: 'ALTAR', admin: 'ALT Command Centre' };
  const q = new URLSearchParams(location.search);
  const platform = PLATFORMS[q.get('platform')] ? q.get('platform') : null;
  const returnMode = ['popup', 'app', 'redirect'].includes(q.get('return')) ? q.get('return') : 'redirect';
  const state = (q.get('state') || '').slice(0, 128);
  // The window is opened through the gateway, so Core's API lives next to it under /core.
  const API = '/core';

  const $ = (sel, root = document) => root.querySelector(sel);
  const views = [...document.querySelectorAll('.view')];
  let email = null; // the address codes were sent to
  let mfaToken = null;

  function show(id) {
    for (const v of views) v.hidden = v.id !== id;
    const view = $('#' + id);
    for (const el of view.querySelectorAll('.email')) el.textContent = email || '';
    const first = view.querySelector('input');
    if (first) setTimeout(() => first.focus(), 0);
  }

  function fail(view, message) {
    const box = view.querySelector('.error');
    box.textContent = message;
    box.hidden = !message;
  }

  async function call(path, { method = 'POST', body, token } = {}) {
    const headers = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'omit' });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const err = new Error(data?.error?.message || `Something went wrong (${res.status}).`);
      err.code = data?.error?.code;
      err.details = data?.error?.details;
      throw err;
    }
    return data;
  }

  const readable = (err) => {
    const issue = err.details?.issues?.[0];
    if (issue?.message) {
      const field = String(issue.path || '').replace(/^\//, '');
      return field ? `${field}: ${issue.message}` : issue.message;
    }
    return err.message;
  };

  // A short window session (client "app", so no cookie is set) is enough to ask for a handoff code.
  const device = () => ({ platform, client: 'app', deviceName: `ALT sign-in window (${PLATFORMS[platform]})` });

  // Someone who just created their account agreed to the policies the sign-up form showed them.
  let justSignedUp = false;
  async function recordAgreement(token) {
    try {
      const { pending } = await call('/me/policies', { method: 'GET', token });
      for (const p of pending) await call('/me/policies/accept', { body: { slug: p.slug, version: p.version }, token });
    } catch {
      // The apps ask again if this didn't go through.
    }
  }

  async function finish(tokens) {
    if (justSignedUp) await recordAgreement(tokens.accessToken);
    const { code, url } = await call('/auth/handoff', { body: { target: platform }, token: tokens.accessToken });
    // End the window session at once: the platform gets its own session from the code.
    try {
      await call(`/me/sessions/${tokens.sessionId}`, { method: 'DELETE', token: tokens.accessToken });
    } catch {
      // The code is already issued; a leftover window session still expires on its own.
    }
    deliver(code, url);
  }

  function deliver(code, url) {
    const name = PLATFORMS[platform];
    // A phone app checks that the answer carries the state it sent, so it knows it asked for this sign-in.
    if (returnMode === 'app' && state) url += `${url.includes('?') ? '&' : '?'}state=${encodeURIComponent(state)}`;
    show('done');
    $('#done-title').textContent = 'You’re signed in';
    if (returnMode === 'popup' && window.opener) {
      // Same origin only: every ALT web app is served by the gateway on this origin.
      window.opener.postMessage({ type: 'alt:handoff', code, state }, location.origin);
      $('#done-text').textContent = `Returning to ${name}…`;
      setTimeout(() => window.close(), 400);
      return;
    }
    $('#done-text').textContent = returnMode === 'app' ? `Tap below if ${name} doesn’t open by itself.` : `Taking you to ${name}…`;
    const back = $('#back');
    back.textContent = `Back to ${name}`;
    back.href = url;
    back.hidden = false;
    location.href = url;
  }

  async function signedIn(data) {
    if (data.mfaRequired) {
      mfaToken = data.mfaToken;
      show('mfa');
      return;
    }
    await finish(data);
  }

  function guard(form, handler) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const button = form.querySelector('button[type=submit]');
      fail(form, null);
      // Say what's missing in plain words before asking the server.
      const empty = [...form.querySelectorAll('input[required]')].find((i) => !i.value.trim());
      if (empty) {
        const label = empty.closest('label')?.firstChild?.textContent.trim().toLowerCase() || 'this field';
        fail(form, `Please enter your ${label}.`);
        empty.focus();
        return;
      }
      button.disabled = true;
      try {
        await handler(new FormData(form));
      } catch (err) {
        if (err.code === 'EMAIL_NOT_VERIFIED') {
          email = err.details?.email || email;
          show('verify');
        } else {
          fail(form, readable(err));
        }
      } finally {
        button.disabled = false;
      }
    });
  }

  guard($('#signin'), async (f) => {
    const identifier = String(f.get('identifier')).trim();
    if (identifier.includes('@')) email = identifier.toLowerCase();
    await signedIn(await call('/auth/login', { body: { identifier, password: String(f.get('password')), ...device() } }));
  });

  guard($('#mfa'), async (f) => {
    const code = String(f.get('code')).trim();
    const body = { mfaToken, client: 'app', ...(code.includes('-') ? { recoveryCode: code } : { code }) };
    await finish(await call('/auth/login/2fa', { body }));
  });

  guard($('#signup'), async (f) => {
    email = String(f.get('email')).trim().toLowerCase();
    await call('/auth/register', { body: {
      displayName: String(f.get('displayName')).trim(),
      handle: String(f.get('handle')).trim(),
      email,
      password: String(f.get('password')),
    } });
    show('verify');
  });

  guard($('#verify'), async (f) => {
    justSignedUp = true;
    await signedIn(await call('/auth/email/verify', { body: { email, code: String(f.get('code')).trim(), ...device() } }));
  });

  guard($('#forgot'), async (f) => {
    email = String(f.get('email')).trim().toLowerCase();
    await call('/auth/password/forgot', { body: { email } });
    show('reset');
  });

  guard($('#reset'), async (f) => {
    await call('/auth/password/reset', { body: { email, code: String(f.get('code')).trim(), newPassword: String(f.get('newPassword')) } });
    show('signin');
    $('#signin [name=identifier]').value = email;
    fail($('#signin'), null);
    const lead = $('#signin .lead');
    lead.textContent = 'Password changed. Sign in with the new one.';
  });

  for (const el of document.querySelectorAll('[data-go]')) el.addEventListener('click', () => show(el.dataset.go));
  $('[data-action=resend]').addEventListener('click', async (e) => {
    const view = e.target.closest('form');
    try {
      await call('/auth/otp/resend', { body: { email } });
      fail(view, null);
      e.target.textContent = 'Code sent';
    } catch (err) {
      fail(view, readable(err));
    }
  });
  // One eye icon: open shows the password, crossed out hides it again.
  for (const btn of document.querySelectorAll('.reveal')) {
    btn.addEventListener('click', () => {
      const input = btn.previousElementSibling;
      const hidden = input.type === 'password';
      input.type = hidden ? 'text' : 'password';
      btn.classList.toggle('on', hidden);
      btn.setAttribute('aria-pressed', String(hidden));
      btn.setAttribute('aria-label', hidden ? 'Hide password' : 'Show password');
    });
  }

  // Development only: Core serves the outbox of codes it would have emailed.
  fetch(API + '/dev/mail', { credentials: 'omit' })
    .then((r) => {
      if (r.ok) for (const el of document.querySelectorAll('.devmail')) el.hidden = false;
    })
    .catch(() => {});

  // ---------------------------------------------------------------- confirming a spend
  const LABELS = {
    price: 'Price', days: 'Days', pricePerDay: 'Per day', months: 'Months', pricePerMonth: 'Per month', amount: 'Amount', to: 'To',
    salePrice: 'For sale at', rentPricePerDay: 'Rent per day', rentMaxDays: 'Longest rental', subscriptionPricePerMonth: 'Subscription per month',
  };
  const POL = new Set(['price', 'pricePerDay', 'pricePerMonth', 'amount', 'salePrice', 'rentPricePerDay', 'subscriptionPricePerMonth']);
  const TITLES = { buy: 'Buy', rent: 'Rent', subscribe: 'Subscribe to', list: 'List', withdraw: 'Withdraw your earnings', send: 'Send POL' };

  function startConfirm() {
    const action = q.get('action');
    if (!TITLES[action] || returnMode !== 'popup' || !window.opener) {
      show('done');
      $('.tick').hidden = true;
      $('#done-title').textContent = 'Nothing to confirm';
      $('#done-text').textContent = 'Open this from ALTAR when you buy, rent, subscribe, list or send.';
      return;
    }
    const aiId = q.get('ai') || undefined;
    const reserved = new Set(['mode', 'platform', 'return', 'state', 'action', 'ai', 'handle']);
    const params = {};
    for (const [k, v] of q) if (!reserved.has(k) && LABELS[k]) params[k] = v.slice(0, 200);
    const form = $('#confirm');
    let token = null;
    let useCode = false;

    // What is being confirmed, exactly as Core will bind it.
    const rows = [];
    const show2 = (k, v) => (v === 'off' ? 'Not offered' : v === 'keep' ? 'Unchanged' : POL.has(k) ? `${v} POL` : v);
    for (const [k, v] of Object.entries(params)) rows.push([LABELS[k], show2(k, v)]);
    const n = Number(params.days || params.months);
    const each = Number(params.pricePerDay || params.pricePerMonth);
    if (n && each) rows.push(['Total', `${+(n * each).toFixed(6)} POL`, true]);
    const dl = $('#confirm-summary');
    dl.replaceChildren();
    for (const [k, v, total] of rows) {
      const dt = document.createElement('dt');
      const dd = document.createElement('dd');
      dt.textContent = k;
      dd.textContent = v;
      if (total) dt.className = dd.className = 'total';
      dl.append(dt, dd);
    }
    dl.hidden = rows.length === 0;
    $('#confirm-title').textContent = TITLES[action];
    $('#confirm-go').textContent = action === 'list' ? 'Confirm listing' : action === 'withdraw' ? 'Withdraw' : 'Confirm payment';

    // The AI by its public profile, so the name shown is ALT's own, not the page's.
    const handle = q.get('handle');
    if (aiId && handle) {
      fetch(`${API}/public/ais/${encodeURIComponent(handle)}`, { credentials: 'omit' })
        .then((r) => (r.ok ? r.json() : null))
        .then((ai) => {
          if (!ai || ai.id !== aiId) return fail(form, 'This request does not match that AI. Close this window and try again.');
          $('#confirm-title').textContent = `${TITLES[action]} ${ai.name}`;
          const who = $('#confirm-ai');
          who.querySelector('span').textContent = `@${ai.handle}`;
          if (ai.avatarUrl) who.querySelector('img').src = ai.avatarUrl;
          who.hidden = false;
        })
        .catch(() => {});
    }

    // Borrow the opener's session for this one request (same origin only).
    window.addEventListener('message', (e) => {
      if (e.origin !== location.origin || e.source !== window.opener) return;
      if (e.data?.type === 'alt:token' && e.data.state === state) token = e.data.token;
    });
    window.opener.postMessage({ type: 'alt:confirm-ready', state }, location.origin);

    $('#confirm-switch').addEventListener('click', () => {
      useCode = !useCode;
      const input = form.querySelector('input[name=secret]');
      input.value = '';
      input.type = useCode ? 'text' : 'password';
      input.autocomplete = useCode ? 'one-time-code' : 'current-password';
      $('#confirm-label').firstChild.textContent = useCode ? 'Code from your authenticator app' : 'Your ALT password';
      $('#confirm-switch').textContent = useCode ? 'Use your password instead' : 'Use a code from your authenticator app';
      input.focus();
    });
    $('#confirm-cancel').addEventListener('click', () => {
      window.opener.postMessage({ type: 'alt:approval-cancelled', state }, location.origin);
      window.close();
    });

    guard(form, async (f) => {
      if (!token) throw new Error('ALTAR did not answer. Close this window and try again.');
      const secret = String(f.get('secret'));
      const { approval } = await call('/me/spend-approvals', {
        token,
        body: { action, aiId, params, confirm: useCode ? { code: secret.trim() } : { password: secret } },
      });
      window.opener.postMessage({ type: 'alt:approval', state, approval }, location.origin);
      show('done');
      $('#done-title').textContent = 'Confirmed';
      $('#done-text').textContent = 'Returning to ALTAR…';
      setTimeout(() => window.close(), 400);
    });
    show('confirm');
  }

  if (q.get('mode') === 'confirm' && platform === 'altar') {
    document.title = 'ALT Account · Confirm';
    startConfirm();
    return;
  }

  if (!platform) {
    show('done');
    $('.tick').hidden = true;
    $('#done-title').textContent = 'Open this from an ALT app';
    $('#done-text').textContent = 'Use “Continue with ALT” in ALTER, ALTERA or ALTAR.';
    return;
  }
  $('#for').hidden = false;
  const chip = $('#platform-chip');
  chip.textContent = PLATFORMS[platform];
  chip.classList.add(platform);
  document.title = `ALT Account · ${PLATFORMS[platform]}`;
  show(q.get('mode') === 'signup' ? 'signup' : 'signin');
})();
