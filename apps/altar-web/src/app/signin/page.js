"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { auth, nextPath } from "../../lib/alt";
import { AuthCard, DevMailHint, ErrorText, Field, OneAccountNote, SubmitButton } from "../../components/AuthCard";

export default function SignIn() {
  const router = useRouter();
  const [stage, setStage] = useState("password"); // password → (mfa | verify)
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [mfaToken, setMfaToken] = useState(null);
  const [email, setEmail] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      if (err.code === "EMAIL_NOT_VERIFIED") {
        setEmail(err.details?.email ?? identifier);
        setStage("verify");
        setCode("");
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const finish = (res) => {
    if (res.mfaToken) {
      setMfaToken(res.mfaToken);
      setStage("mfa");
      setCode("");
      return;
    }
    router.push(nextPath());
  };

  const submit = (e) => {
    e.preventDefault();
    if (stage === "password") return run(async () => finish(await auth.login(identifier.trim(), password)));
    if (stage === "mfa") return run(async () => finish(await auth.loginWithCode(mfaToken, code.trim())));
    return run(async () => finish(await auth.verifyEmail(email, code.trim())));
  };

  return (
    <AuthCard badge="ALT Account" subtitle={stage === "password" ? "Sign in to the marketplace" : stage === "mfa" ? "Two-step verification" : "Confirm your email"}>
      <form onSubmit={submit} className="flex flex-col gap-6">
        {stage === "password" && (
          <>
            <Field label="Email or handle" value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="you@example.com" autoComplete="username" required />
            <Field label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Your password" autoComplete="current-password" required />
          </>
        )}
        {stage === "mfa" && (
          <Field label="Code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" inputMode="text" autoComplete="one-time-code" hint="From your authenticator app, or a recovery code like abcd-1234." autoFocus required />
        )}
        {stage === "verify" && (
          <>
            <p className="text-xs text-white/60 text-center leading-relaxed">We sent a 6-digit code to <b className="text-white">{email}</b>.</p>
            <DevMailHint />
            <Field label="Email code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" inputMode="numeric" autoComplete="one-time-code" autoFocus required />
          </>
        )}
        <ErrorText>{error}</ErrorText>
        <SubmitButton busy={busy}>{stage === "password" ? "Sign in" : "Continue"}</SubmitButton>
        {stage === "verify" && (
          <button type="button" onClick={() => run(() => auth.resendCode(email))} className="text-[10px] font-black uppercase tracking-widest text-white/40 hover:text-green-400">
            Send a new code
          </button>
        )}
        {stage !== "password" && (
          <button type="button" onClick={() => setStage("password")} className="text-[10px] font-black uppercase tracking-widest text-white/40 hover:text-white">
            ← Back
          </button>
        )}
      </form>

      <OneAccountNote />

      <p className="text-[10px] text-center font-bold text-white/40 uppercase tracking-widest">
        New to ALT?{" "}
        <button onClick={() => router.push("/signup")} className="text-green-400 font-black hover:text-white transition-colors ml-1 decoration-dashed underline underline-offset-4">
          Create an account
        </button>
      </p>
    </AuthCard>
  );
}
