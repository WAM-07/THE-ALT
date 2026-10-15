"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../contexts/AuthContext";
import { policies } from "../lib/alt";

/** When ALT publishes a new version of a policy, signed-in people are asked to read it and agree. */
export default function PolicyBanner() {
  const { user } = useAuth();
  const [pending, setPending] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    if (!user) {
      setPending([]);
      return;
    }
    policies
      .mine()
      .then((m) => live && setPending(m.pending))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [user]);

  if (!pending.length) return null;
  async function agreeAll() {
    setBusy(true);
    try {
      let left = pending;
      for (const p of pending) left = (await policies.accept(p.slug, p.version)).pending;
      setPending(left);
    } finally {
      setBusy(false);
    }
  }
  const updated = pending.some((p) => p.acceptedVersion);
  return (
    <div className="border-b border-line bg-sunken/80">
      <div className="mx-auto flex max-w-[1320px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm sm:px-6">
        <span className="font-semibold">{updated ? "ALT updated its policies." : "Please read ALT's policies."}</span>
        <span className="flex flex-wrap gap-3">
          {pending.map((p) => (
            <Link key={p.slug} href={`/legal/${p.slug}`} className="underline underline-offset-4 hover:text-ink">
              {p.title} (v{p.version})
            </Link>
          ))}
        </span>
        <button onClick={agreeAll} disabled={busy} className="ml-auto rounded-full bg-ink px-4 py-1.5 font-semibold text-canvas disabled:opacity-60">
          {busy ? "Saving…" : "I agree"}
        </button>
      </div>
    </div>
  );
}
