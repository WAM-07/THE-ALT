// The ALT Command Centre's only way to talk to ALT: ALT Core through the gateway, on the same origin.
//
// Staff sessions live in this tab's memory and nowhere else (no cookie, no storage): reloading or
// closing the tab signs out. The Command Centre signs in through the ALT Account window as platform
// "admin", which is the only kind of session Core's /staff routes accept.

let session = null; // { accessToken, refreshToken, sessionId, user }
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn(session));

export const currentSession = () => session;
export function onSession(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export class AltError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function send(path, { method = "GET", body, token } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: "omit",
      cache: "no-store",
    });
  } catch {
    throw new AltError(0, "OFFLINE", "ALT can't be reached. Check that it is running.");
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // not JSON
  }
  if (!res.ok) {
    const e = data?.error;
    throw new AltError(res.status, e?.code ?? `HTTP_${res.status}`, e?.message ?? `Request failed (${res.status}).`, e?.details);
  }
  return data;
}

function adopt(p) {
  session = { accessToken: p.accessToken, refreshToken: p.refreshToken, sessionId: p.sessionId ?? session?.sessionId, user: p.user ?? session?.user };
  emit();
  return session;
}

function drop() {
  session = null;
  emit();
}

let refreshing = null;
function refresh() {
  if (!session) return Promise.reject(new AltError(401, "SIGNED_OUT", "Sign in again."));
  refreshing ??= send("/core/auth/refresh", { method: "POST", body: { refreshToken: session.refreshToken } })
    .then(adopt)
    .catch((e) => {
      drop();
      throw e;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

/** Calls ALT as the signed-in member of staff, refreshing the access token once if it expired. */
export async function api(path, opts = {}) {
  if (!session) throw new AltError(401, "SIGNED_OUT", "Sign in again.");
  try {
    return await send(path, { ...opts, token: session.accessToken });
  } catch (e) {
    if (e.status !== 401) throw e;
    if (e.code === "SESSION_REVOKED") {
      drop();
      throw e;
    }
    await refresh();
    return send(path, { ...opts, token: session.accessToken });
  }
}

const deviceName = () => {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "browser";
  return `ALT Command Centre (${browser})`;
};

/** Turns a one-time code from the ALT Account window into this tab's staff session. */
export async function redeemHandoff(code) {
  return adopt(await send("/core/auth/handoff/redeem", { method: "POST", body: { code, platform: "admin", client: "app", deviceName: deviceName() } }));
}

/**
 * Opens the ALT Account window as a popup ("to continue to ALT Command Centre"): password and 2FA happen
 * there, and it posts back a one-time code. If popups are blocked, it opens full-page and returns
 * through /command/handoff. Resolves to the session, or null if the window was closed.
 */
export function signIn() {
  const state = crypto.randomUUID();
  const url = (ret) => `/core/account/?platform=admin&return=${ret}&state=${state}`;
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
        resolve(await redeemHandoff(e.data.code));
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

export async function signOut() {
  try {
    if (session) await send("/core/auth/logout", { method: "POST", token: session.accessToken });
  } catch {
    // Signed out locally either way; the session also ends on its own.
  }
  drop();
}
