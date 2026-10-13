"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { auth } from "../../lib/alt";
import { AuthCard, DevMailHint, ErrorText, Field, OneAccountNote, SubmitButton } from "../../components/AuthCard";

// Creates an ALT account (the same one ALTER and ALTERA use), then confirms the email code.
export default function SignUp() {
  const router = useRouter();
  const [form, setForm] = useState({ displayName: "", handle: "", email: "", password: "" });
  const [stage, setStage] = useState("form"); // form → verify
  const [code, setCode] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      // Core explains field problems in details (zod); show the first one plainly.
      const issue = err.details?.issues?.[0];
      const field = String(issue?.path ?? "").replace(/^\//, "");
      setError(issue?.message ? `${field ? field + ": " : ""}${issue.message}` : err.message);
    } finally {
      setBusy(false);
    }
  };

  const submit = (e) => {
    e.preventDefault();
    if (stage === "form") {
      return run(async () => {
        await auth.register({ ...form, email: form.email.trim().toLowerCase(), handle: form.handle.trim(), roles: ["consumer"] });
        setStage("verify");
      });
    }
    return run(async () => {
      const res = await auth.verifyEmail(form.email.trim().toLowerCase(), code.trim());
      router.push(res.mfaToken ? "/signin" : "/profile");
    });
  };

  return (
    <AuthCard badge="New ALT Account" subtitle={stage === "form" ? "One account for every ALT app" : "Confirm your email"}>
      <form onSubmit={submit} className="flex flex-col gap-5">
        {stage === "form" ? (
          <>
            <Field label="Name" name="displayName" value={form.displayName} onChange={set} placeholder="Your name" autoComplete="name" required />
            <Field label="Handle" name="handle" value={form.handle} onChange={set} placeholder="your_handle" autoComplete="username" hint="3–30 letters, numbers, _ or ." required />
            <Field label="Email" name="email" type="email" value={form.email} onChange={set} placeholder="you@example.com" autoComplete="email" required />
            <Field label="Password" name="password" type="password" value={form.password} onChange={set} placeholder="At least 8 characters" autoComplete="new-password" hint="At least 8 characters, with a letter and a number." required />
          </>
        ) : (
          <>
            <p className="text-xs text-white/60 text-center leading-relaxed">We sent a 6-digit code to <b className="text-white">{form.email}</b>.</p>
            <DevMailHint />
            <Field label="Email code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" inputMode="numeric" autoComplete="one-time-code" autoFocus required />
          </>
        )}
        <ErrorText>{error}</ErrorText>
        <SubmitButton busy={busy}>{stage === "form" ? "Create account" : "Confirm"}</SubmitButton>
        {stage === "verify" && (
          <button type="button" onClick={() => run(() => auth.resendCode(form.email.trim().toLowerCase()))} className="text-[10px] font-black uppercase tracking-widest text-white/40 hover:text-green-400">
            Send a new code
          </button>
        )}
      </form>

      <OneAccountNote />

      <p className="text-[10px] text-center font-bold text-white/40 uppercase tracking-widest">
        Already on ALT?{" "}
        <button onClick={() => router.push("/signin")} className="text-green-400 font-black hover:text-white transition-colors ml-1 decoration-dashed underline underline-offset-4">
          Sign in
        </button>
      </p>
    </AuthCard>
  );
}
