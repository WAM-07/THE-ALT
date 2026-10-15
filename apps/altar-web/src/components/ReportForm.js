"use client";
import { useState } from "react";
import { Button } from "./ui";

export const REPORT_REASONS = {
  ai: [
    ["impersonation", "Pretends to be a real person"],
    ["harmful", "Harmful or dangerous answers"],
    ["scam", "Scam or misleading listing"],
    ["copyright", "Copies someone else's work"],
    ["other", "Something else"],
  ],
  review: [
    ["fake", "Fake or not a real experience"],
    ["offensive", "Offensive or hateful"],
    ["spam", "Spam or advertising"],
    ["private_data", "Shares private information"],
    ["other", "Something else"],
  ],
};

/**
 * Tells ALT staff about something wrong. The report goes to the ALT Command Centre; the person
 * hears the outcome in their ALT inbox and under Help & support.
 */
export default function ReportForm({ what, reasons, onSubmit, onClose }) {
  const [reason, setReason] = useState(reasons[0][0]);
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  async function send(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit(reason, details.trim());
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (done)
    return (
      <div className="animate-page-in mt-3 rounded-2xl bg-sunken/60 p-4 text-sm">
        <p className="font-semibold">Thanks. ALT staff will look at it.</p>
        <p className="mt-1 text-ink-3">You&apos;ll hear the outcome in your ALT inbox, and can follow it under Settings → Help &amp; support.</p>
        <button onClick={onClose} className="mt-2 font-semibold text-ink-2 underline underline-offset-4 hover:text-ink">
          Close
        </button>
      </div>
    );

  return (
    <form onSubmit={send} className="animate-page-in mt-3 rounded-2xl bg-sunken/60 p-4">
      <p className="text-sm font-semibold">What&apos;s wrong with {what}?</p>
      <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Reason">
        {reasons.map(([v, label]) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={reason === v}
            onClick={() => setReason(v)}
            className={`rounded-full border px-3 py-1.5 text-sm transition ${reason === v ? "border-ink bg-ink text-canvas" : "border-line bg-surface text-ink-2 hover:border-ink/30"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <textarea
        value={details}
        onChange={(e) => setDetails(e.target.value)}
        maxLength={1000}
        rows={3}
        placeholder="Anything that helps staff check it (optional)"
        className="mt-3 w-full rounded-2xl border border-line bg-surface px-4 py-3 text-[15px] text-ink outline-none focus:border-ink/30"
      />
      {error && <p className="mt-2 rounded-2xl bg-rose-500/10 px-4 py-2 text-sm text-rose-600">{error}</p>}
      <div className="mt-3 flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? "Sending…" : "Send report"}
        </Button>
        <Button type="button" kind="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
