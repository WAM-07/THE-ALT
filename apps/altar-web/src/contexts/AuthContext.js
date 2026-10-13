"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { auth, mediaUrl, onSession, refresh } from "../lib/alt";

// The signed-in ALT account. ALTAR has no accounts of its own: sign-in, sign-up, 2FA and
// sessions all belong to ALT Core, so one account works across ALTER, ALTERA and ALTAR.
const AuthContext = createContext();

/** Core's account, plus the short names the ALTAR screens use. */
const shape = (me) =>
  me && {
    ...me,
    name: me.displayName,
    // ALTAR shows the picture chosen for ALTAR, if any, otherwise the ALT account's picture.
    picture: mediaUrl(me.platformAvatars?.altar ?? me.avatarUrl),
    hasAltarPicture: Boolean(me.platformAvatars?.altar),
    wallet: me.wallets?.find((w) => w.isPrimary) ?? me.wallets?.[0] ?? null,
  };

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stop = onSession((me) => setUser(shape(me)));
    // Restore the session from the httpOnly refresh cookie, if there is one.
    refresh()
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
    return stop;
  }, []);

  const logout = async () => {
    await auth.logout().catch(() => {});
    window.location.href = "/signin";
  };

  return (
    <AuthContext.Provider value={{ user, loading, logout, auth }}>
      {!loading && children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
