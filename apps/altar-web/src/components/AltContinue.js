"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { continueWithAlt, nextPath } from "../lib/alt";
import { AuthCard, ErrorText, OneAccountNote } from "./AuthCard";
import { AltMark } from "./BrandLogo";

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
    <AuthCard title={signup ? "Join ALTAR" : "Welcome back"} subtitle="Own, rent and subscribe to verified AIs.">
      <p className="text-[15px] leading-relaxed text-ink-2">
        ALTAR uses your <b className="text-ink">ALT account</b>. Signing in happens in ALT&apos;s own window, so ALTAR never sees your password.
      </p>
      <ErrorText>{error}</ErrorText>
      <button
        onClick={() => go(signup ? "signup" : "signin")}
        disabled={busy}
        className="flex h-13 items-center justify-center gap-3 rounded-full bg-pop text-[15px] font-semibold text-pop-ink transition hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
      >
        <AltMark className="h-6 w-6" />
        {busy ? "Waiting for ALT…" : signup ? "Create an ALT account" : "Continue with ALT"}
      </button>
      <OneAccountNote />
      <p className="text-center text-sm text-ink-2">
        {signup ? "Already on ALT?" : "New to ALT?"}{" "}
        <button onClick={() => go(signup ? "signin" : "signup")} className="font-semibold text-ink underline underline-offset-4">
          {signup ? "Sign in" : "Create an account"}
        </button>
      </p>
    </AuthCard>
  );
}
