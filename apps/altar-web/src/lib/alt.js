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
  // Files go as multipart form data (the browser sets that content type); everything else as JSON.
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  if (body !== undefined && !isForm) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
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

/**
 * Profile pictures. They live in the ALT account, so a change shows in ALTER, ALTERA and ALTAR;
 * a person may also pick a different one for ALTAR only. People and AIs choose from separate
 * ready-made sets ("human" and "ai"), or upload their own.
 */
export const pictures = {
  presets: (kind) => publicApi(`/core/avatars/presets?kind=${kind}`).then((r) => r.sets),
  /** Everywhere, or (altarOnly) just on ALTAR; null goes back to the default. Announces the updated account. */
  async choose(avatarUrl, { altarOnly = false } = {}) {
    const me = altarOnly
      ? await api("/core/me/avatar/altar", { method: "PUT", body: { avatarUrl } })
      : await api("/core/me", { method: "PATCH", body: { avatarUrl } });
    emit(me);
  },
  async upload(file, { altarOnly = false } = {}) {
    const form = new FormData();
    form.append("file", file);
    await api(`/core/me/avatar${altarOnly ? "?platform=altar" : ""}`, { method: "POST", body: form });
    emit(await api("/core/me"));
  },
  /** An AI's picture (its owner only). */
  chooseForAi: (aiId, avatarUrl) => api(`/core/ais/${aiId}`, { method: "PATCH", body: { avatarUrl } }),
  async uploadForAi(aiId, file) {
    const form = new FormData();
    form.append("file", file);
    return api(`/core/ais/${aiId}/avatar`, { method: "POST", body: form });
  },
};

/**
 * The ALT wallet and on-chain listings. ALT Core holds the wallet's keys and signs; anything that
 * spends needs `confirm`: { password } or { code } (two-step verification).
 */
export const wallet = {
  get: () => api("/core/me/wallet"),
  testFunds: () => api("/core/me/wallet/test-funds", { method: "POST", body: {} }),
  withdraw: (confirm) => api("/core/me/wallet/withdraw", { method: "POST", body: { confirm } }),
  send: (to, amount, confirm) => api("/core/me/wallet/send", { method: "POST", body: { to, amount, confirm } }),
  /** An AI's sale and rental terms as the marketplace contract has them. */
  market: (aiId) => api(`/core/ais/${aiId}/market`),
  setMarket: (aiId, { sale, rent, subscription }, confirm) => api(`/core/ais/${aiId}/market`, { method: "PUT", body: { sale, rent, subscription, confirm } }),
  /** Buys a listed AI; `expectedPrice` (POL) makes sure the price didn't change at checkout. */
  buy: (aiId, confirm, expectedPrice) => api(`/core/ais/${aiId}/market/buy`, { method: "POST", body: { confirm, expectedPrice } }),
  rent: (aiId, days, confirm, expectedPricePerDay) => api(`/core/ais/${aiId}/market/rent`, { method: "POST", body: { days, confirm, expectedPricePerDay } }),
  subscribe: (aiId, months, confirm, expectedPricePerMonth) => api(`/core/ais/${aiId}/market/subscribe`, { method: "POST", body: { months, confirm, expectedPricePerMonth } }),
};

/** Talking to an AI on ALTAR: its owner always, a renter until the rental ends. */
export const conversations = {
  access: (aiId) => api(`/core/ais/${aiId}/access`),
  list: (aiId) => api(`/core/ais/${aiId}/conversations`),
  start: (aiId) => api(`/core/ais/${aiId}/conversations`, { method: "POST", body: {} }),
  messages: (aiId, id) => api(`/core/ais/${aiId}/conversations/${id}/messages`),
  say: (aiId, id, content) => api(`/core/ais/${aiId}/conversations/${id}/messages`, { method: "POST", body: { content } }),
};

/** ALTAR's own service: listing details, subscription prices and saved AIs. */
export const altar = {
  listings: () => publicApi("/altar/listings"),
  listing: (aiId) => publicApi(`/altar/listings/${aiId}`),
  /** Saves pitch, terms and subscription price; sale and rent prices are read back from the chain. */
  saveListing: (aiId, body) => api(`/altar/listings/${aiId}`, { method: "PUT", body }),
  /** Sales and rentals, read from the marketplace contract's events. */
  activity: (aiId) => publicApi(`/altar/activity?aiId=${aiId}`),
  myActivity: () => api("/altar/me/activity"),
  myRentals: () => api("/altar/me/rentals"),
  myRoyalties: () => api("/altar/me/royalties"),
  /** Reviews come only from people who bought, rented or subscribed (checked against the chain's record). */
  reviews: (aiId) => publicApi(`/altar/reviews?aiId=${aiId}`),
  ratings: () => publicApi("/altar/ratings"),
  myReview: (aiId) => api(`/altar/me/reviews/${aiId}`),
  saveReview: (aiId, rating, body) => api(`/altar/reviews/${aiId}`, { method: "PUT", body: { rating, body } }),
  deleteReview: (aiId) => api(`/altar/reviews/${aiId}`, { method: "DELETE" }),
  saved: () => api("/altar/wishlist"),
  save: (aiId) => api(`/altar/wishlist/${aiId}`, { method: "PUT" }),
  unsave: (aiId) => api(`/altar/wishlist/${aiId}`, { method: "DELETE" }),
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

/**
 * "Continue with ALT": opens the ALT Account window (served by ALT Core) as a popup, like
 * "Continue with Google". The window signs the person in or registers them and posts back a
 * one-time handoff code, which becomes ALTAR's own session. ALTAR never sees the password.
 * If popups are blocked, the window opens full-page and comes back through /handoff instead.
 * Resolves to the signed-in user, or null if the person closed the window.
 */
export function continueWithAlt(mode = "signin", next = null) {
  const state = crypto.randomUUID();
  const url = (ret) => `/core/account/?platform=altar&mode=${mode}&return=${ret}&state=${state}`;
  try {
    if (next) sessionStorage.setItem("altar_next", next);
  } catch {
    // Storage blocked: after sign-in the person lands on My AIs.
  }
  const w = 460;
  const h = 700;
  const left = Math.max(0, window.screenX + (window.outerWidth - w) / 2);
  const top = Math.max(0, window.screenY + (window.outerHeight - h) / 2);
  const popup = window.open(url("popup"), "alt-account", `popup=yes,width=${w},height=${h},left=${left},top=${top}`);
  if (!popup) {
    window.location.href = url("redirect");
    return new Promise(() => {});
  }
  popup.focus();
  return new Promise((resolve, reject) => {
    const done = () => {
      window.removeEventListener("message", onMessage);
      clearInterval(watch);
    };
    const onMessage = async (e) => {
      // Only the window we opened, on our own origin, answering our own request.
      if (e.origin !== window.location.origin || e.source !== popup) return;
      if (e.data?.type !== "alt:handoff" || e.data.state !== state) return;
      done();
      try {
        resolve((await auth.redeemHandoff(e.data.code)).user);
      } catch (err) {
        reject(err);
      }
    };
    window.addEventListener("message", onMessage);
    const watch = setInterval(() => {
      if (popup.closed) {
        done();
        resolve(null);
      }
    }, 500);
  });
}

/** Where /handoff should go after a full-page sign-in (set by continueWithAlt). */
export function takeNextPath(fallback = "/profile") {
  try {
    const next = sessionStorage.getItem("altar_next");
    sessionStorage.removeItem("altar_next");
    if (next && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\")) return next;
  } catch {
    // ignore
  }
  return fallback;
}
