"use client";
import { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { confirmInAltWindow } from "../lib/alt";
import { Button } from "./ui";

/**
 * "Confirm it's you" before ALT signs with your wallet. With `intent` (what is being paid, see
 * confirmInAltWindow) the person confirms in the ALT Account window, which returns a one-time
 * approval, so ALTAR never sees the password. If popups are blocked, the password or 2FA code can
 * be typed here instead; it goes straight to ALT Core with the request and is never stored.
 *
 * onConfirm(confirm) does the action and may throw; the error is shown here.
 */
export default function ConfirmSpend({ title, children, action = "Confirm", intent, onConfirm, onClose, onDone }) {
  const { user } = useAuth();
  const canPassword = Boolean(user?.hasPassword);
  const canCode = Boolean(user?.twoFactorEnabled);
  const [mode, setMode] = useState(canPassword ? "password" : "code");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // Typing the password here is only the fallback when the ALT window can't open.
  const [onPage, setOnPage] = useState(!intent);

  useEffect(() => {
    const esc = (e) => e.key === "Escape" && !busy && onClose();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [busy, onClose]);

  const run = async (confirm) => {
    const result = await onConfirm(confirm);
    onDone?.(result);
    onClose();
  };

  const inAltWindow = async () => {
    setBusy(true);
    setError(null);
    const answer = await confirmInAltWindow(intent);
    if (answer === undefined) {
      setBusy(false);
      setOnPage(true);
      return setError("Your browser blocked the ALT window. Allow pop-ups for ALTAR, or confirm here.");
    }
    if (!answer) return setBusy(false);
    try {
      await run({ approval: answer.approval });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!onPage) return inAltWindow();
    if (!secret.trim()) return setError(mode === "password" ? "Please enter your password." : "Please enter the code.");
    setBusy(true);
    setError(null);
    try {
      await run(mode === "password" ? { password: secret } : { code: secret.trim() });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[95] flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !busy && onClose()} />
      <form onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="confirm-title" className="animate-page-in relative w-full max-w-md rounded-t-[28px] border border-line bg-surface p-6 shadow-card sm:rounded-[28px] sm:p-7">
        <h2 id="confirm-title" className="font-display text-xl font-bold">
          {title}
        </h2>
        <div className="mt-3 text-[15px] leading-relaxed text-ink-2">{children}</div>

        {!onPage ? (
          <p className="mt-5 rounded-2xl bg-sunken/70 px-4 py-3 text-sm text-ink-2">
            You confirm in the <b className="text-ink">ALT Account</b> window with your password or two-step code. ALTAR never sees it.
          </p>
        ) : !canPassword && !canCode ? (
          <p className="mt-5 rounded-2xl bg-amber-500/10 px-4 py-3 text-sm text-ink-2">
            To spend from your wallet, first set a password or turn on two-step verification in the ALT Account Center (in ALTER or ALTERA).
          </p>
        ) : (
          <label className="mt-5 block text-sm font-semibold text-ink-2">
            {mode === "password" ? "Your ALT password" : "Code from your authenticator app"}
            <input
              autoFocus
              type={mode === "password" ? "password" : "text"}
              inputMode={mode === "password" ? undefined : "numeric"}
              autoComplete={mode === "password" ? "current-password" : "one-time-code"}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              className="mt-1.5 h-12 w-full rounded-2xl border border-line bg-sunken/60 px-4 text-[15px] text-ink outline-none focus:border-ink/30"
            />
          </label>
        )}
        {onPage && canPassword && canCode && (
          <button
            type="button"
            onClick={() => {
              setMode(mode === "password" ? "code" : "password");
              setSecret("");
              setError(null);
            }}
            className="mt-2 text-sm font-semibold text-ink-2 underline underline-offset-4 hover:text-ink"
          >
            {mode === "password" ? "Use a two-step code instead" : "Use your password instead"}
          </button>
        )}
        {error && <p className="mt-4 rounded-2xl bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-600">{error}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" kind="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || (!canPassword && !canCode)}>
            {busy ? (onPage ? "Signing on-chain…" : "Waiting for ALT…") : onPage ? action : `${action} in ALT`}
          </Button>
        </div>
        <p className="mt-4 text-xs text-ink-3">
          {onPage ? "ALT signs this with your ALT wallet. Your password is sent straight to ALT to unlock it and is never stored." : "ALT signs this with your ALT wallet and pays the network fee."}
        </p>
      </form>
    </div>
  );
}
