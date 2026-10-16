"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, currentSession, onSession, restore, signIn as openSignIn, signOut as endSession } from "../lib/alt";

const StaffContext = createContext(null);

/**
 * Who is using the Command Centre: their ALT session (this tab only) and what their staff roles let them
 * see and do, from Core's /staff/me. state: signedOut | checking | ready | notStaff | error.
 */
export function StaffProvider({ children }) {
  const [session, setSession] = useState(currentSession);
  const [staff, setStaff] = useState(null);
  // Starts by looking for a session kept from before (Core's cookie), so a reload stays signed in.
  const [state, setState] = useState("checking");
  const [restored, setRestored] = useState(false);
  const [error, setError] = useState(null);
  const sid = session?.sessionId ?? null;

  useEffect(() => onSession(setSession), []);

  useEffect(() => {
    if (currentSession()) return setRestored(true);
    restore().finally(() => setRestored(true));
  }, []);

  useEffect(() => {
    if (!restored) return;
    if (!sid) {
      setStaff(null);
      setState("signedOut");
      return;
    }
    let live = true;
    setState("checking");
    api("/core/staff/me")
      .then((s) => {
        if (!live) return;
        setStaff(s);
        setError(null);
        setState("ready");
      })
      .catch((e) => {
        if (!live) return;
        setError(e);
        setState(e.status === 403 ? "notStaff" : e.status === 401 ? "signedOut" : "error");
      });
    return () => {
      live = false;
    };
  }, [sid, restored]);

  const signIn = useCallback(async () => {
    setError(null);
    try {
      await openSignIn();
    } catch (e) {
      setError(e);
    }
  }, []);

  const value = {
    session,
    user: session?.user ?? null,
    staff,
    state,
    error,
    signIn,
    signOut: endSession,
    has: (...roles) => Boolean(staff?.roles.some((r) => roles.includes(r))),
    handles: (kind) => Boolean(staff?.handles.includes(kind)),
  };
  return <StaffContext.Provider value={value}>{children}</StaffContext.Provider>;
}

export const useStaff = () => useContext(StaffContext);
