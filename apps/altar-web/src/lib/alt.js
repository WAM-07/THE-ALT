// ALTAR's connection to ALT. Everything goes through the gateway on the same origin
// (/core, /altar, ...), so there are no hard-coded hosts.
//
// The access token lives in memory only. The refresh token is an httpOnly cookie that
// ALT Core sets for web clients, so page scripts can never read it.

export class AltError extends Error {
  constructor(status, body) {
    const e = body?.error ?? {};
    super(e.message || `Request failed (${status})`);
    this.status = status;
    this.code = e.code || "HTTP_" + status;
    this.details = e.details;
  }
}

let accessToken = null;
let refreshing = null;
const listeners = new Set();

/** Called with the signed-in user (or null) whenever the session changes. */
export const onSession = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const emit = (user) => listeners.forEach((fn) => fn(user));

async function send(path, { method = "GET", body, token } = {}) {
  const headers = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
    cache: "no-store",
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new AltError(res.status, data);
  return data;
}

/** Keeps the tokens from a sign-in response and announces the user. */
function adopt(data) {
  if (data?.accessToken) {
    accessToken = data.accessToken;
    emit(data.user ?? null);
  }
  return data;
}

/** Swaps the refresh cookie for a new access token. One request at a time. */
export function refresh() {
  refreshing ??= send("/core/auth/refresh", { method: "POST", body: {} })
    .then(adopt)
    .catch((err) => {
      accessToken = null;
      if (err.status === 401) emit(null);
      throw err;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

/** An authenticated call. Refreshes once on an expired token. */
export async function api(path, opts = {}) {
  if (!accessToken) await refresh();
  try {
    return await send(path, { ...opts, token: accessToken });
  } catch (err) {
    if (err.status !== 401) throw err;
    await refresh();
    return send(path, { ...opts, token: accessToken });
  }
}

/** A public call (no account needed). */
export const publicApi = (path) => send(path);

const device = { platform: "altar", client: "web", deviceName: "ALTAR web" };

export const auth = {
  /** Resolves to { user } when signed in, or { mfaToken } when a 2FA code is needed. */
  async login(identifier, password) {
    const data = await send("/core/auth/login", { method: "POST", body: { identifier, password, ...device } });
    if (data.mfaRequired) return { mfaToken: data.mfaToken };
    return { user: adopt(data).user };
  },
  async loginWithCode(mfaToken, code) {
    const isRecovery = code.includes("-");
    const body = { mfaToken, client: "web", ...(isRecovery ? { recoveryCode: code } : { code }) };
    return { user: adopt(await send("/core/auth/login/2fa", { method: "POST", body })).user };
  },
  register: (form) => send("/core/auth/register", { method: "POST", body: form }),
  async verifyEmail(email, code) {
    const data = await send("/core/auth/email/verify", { method: "POST", body: { email, code, ...device } });
    if (data.mfaRequired) return { mfaToken: data.mfaToken };
    return { user: adopt(data).user };
  },
  resendCode: (email) => send("/core/auth/otp/resend", { method: "POST", body: { email } }),
  /** Signs in with a one-time link from ALTER or ALTERA. */
  async redeemHandoff(code) {
    return { user: adopt(await send("/core/auth/handoff/redeem", { method: "POST", body: { code, ...device } })).user };
  },
  /** A one-time link that opens ALTER or ALTERA already signed in. */
  handoffTo: (target) => api("/core/auth/handoff", { method: "POST", body: { target } }),
  async logout() {
    try {
      await api("/core/auth/logout", { method: "POST", body: {} });
    } finally {
      accessToken = null;
      emit(null);
    }
  },
};

/** ALT file links name the server's public address; serve them from wherever ALTAR is open. */
export function mediaUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url, window.location.origin);
    if (u.pathname.startsWith("/core/") || u.pathname.startsWith("/altar/")) return u.pathname + u.search;
    return u.href;
  } catch {
    return null;
  }
}

/** Where to go after signing in: a path on ALTAR only (never another site). */
export const nextPath = (fallback = "/profile") => {
  const next = new URLSearchParams(window.location.search).get("next");
  return next && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\") ? next : fallback;
};
