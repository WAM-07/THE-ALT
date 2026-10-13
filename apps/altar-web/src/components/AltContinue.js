"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { continueWithAlt, nextPath } from "../lib/alt";
import { AuthCard, ErrorText, OneAccountNote } from "./AuthCard";

// ALTAR has no sign-in form of its own: "Continue with ALT" opens the ALT Account window.
export default function AltContinue({ mode }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const go = async (which) => {
    setBusy(true);
    setError(null);
    const next = nextPath();
    try {
      const user = await continueWithAlt(which, next);
      if (user) router.push(next);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const signup = mode === "signup";
  return (
    <AuthCard badge={signup ? "Join ALTAR" : "Welcome back"} subtitle="Buy, rent and subscribe to verified AIs">
      <p className="text-sm text-white/60 text-center leading-relaxed">
        ALTAR uses your <b className="text-white">ALT account</b>, the same one as ALTER and ALTERA. Signing in happens in ALT&apos;s own window; ALTAR never sees your password.
      </p>
      <ErrorText>{error}</ErrorText>
      <button
        onClick={() => go(signup ? "signup" : "signin")}
        disabled={busy}
        className="group relative flex items-center justify-center gap-3 bg-white text-black p-5 rounded-2xl font-black uppercase tracking-[0.2em] text-xs transition-all hover:-translate-y-1 active:scale-95 disabled:opacity-60 disabled:hover:translate-y-0"
      >
        <span className="inline-grid grid-cols-3 gap-[3px]" aria-hidden="true">
          <i className="block w-[5px] h-4 rounded-sm bg-green-500"></i>
          <i className="block w-[5px] h-4 rounded-sm bg-orange-500"></i>
          <i className="block w-[5px] h-4 rounded-sm bg-black"></i>
        </span>
        {busy ? "Waiting for ALT…" : signup ? "Create an ALT account" : "Continue with ALT"}
      </button>
      <OneAccountNote />
      <p className="text-[10px] text-center font-bold text-white/40 uppercase tracking-widest">
        {signup ? "Already on ALT? " : "New to ALT? "}
        <button onClick={() => go(signup ? "signin" : "signup")} className="text-green-400 font-black hover:text-white transition-colors ml-1 decoration-dashed underline underline-offset-4">
          {signup ? "Sign in" : "Create an account"}
        </button>
      </p>
    </AuthCard>
  );
}
