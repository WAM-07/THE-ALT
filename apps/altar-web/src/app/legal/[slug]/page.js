"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import Markdown from "../../../components/Markdown";
import { Card, Chip } from "../../../components/ui";
import { useAuth } from "../../../contexts/AuthContext";
import { policies } from "../../../lib/alt";
import { PageLoader } from "../../../components/BrandLogo";

const NAMES = { terms: "Terms of use", privacy: "Privacy policy", "ai-content": "AI content policy" };

// ALT's policies, the same for ALTER, ALTERA and ALTAR (the phone apps open these pages too).
// Every version stays readable, so anyone can see what changed and when.
export default function PolicyPage() {
  const { slug } = useParams();
  const { user } = useAuth();
  const [version, setVersion] = useState(null);
  const [policy, setPolicy] = useState(null);
  const [error, setError] = useState(null);
  const [mine, setMine] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    policies
      .get(slug, version)
      .then((p) => live && (setPolicy(p), setError(null)))
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [slug, version]);

  useEffect(() => {
    if (user) policies.mine().then(setMine).catch(() => setMine(null));
  }, [user]);

  if (error) return <p className="mx-auto max-w-3xl px-4 py-16 text-ink-2">{error}</p>;
  if (!policy)
    return (
      <PageLoader className="py-24" />
    );

  const current = policy.versions[0]?.version === policy.version;
  const status = mine?.items.find((p) => p.slug === slug);
  async function agree() {
    setBusy(true);
    try {
      setMine(await policies.accept(slug, policy.version));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 pb-24 pt-8 sm:px-6 sm:pt-12">
      <nav className="flex flex-wrap gap-2 text-sm">
        {Object.entries(NAMES).map(([s, name]) => (
          <Link key={s} href={`/legal/${s}`} className={`rounded-full px-3 py-1.5 font-semibold ${s === slug ? "bg-ink text-canvas" : "bg-sunken text-ink-2 hover:text-ink"}`}>
            {name}
          </Link>
        ))}
      </nav>
      <h1 className="mt-6 font-display text-4xl font-extrabold tracking-tight">{policy.title}</h1>
      <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-3">
        Version {policy.version} · {new Date(policy.publishedAt).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })} · by {policy.publishedBy}
        {!current && <Chip tone="warn">An older version</Chip>}
      </p>

      {user && current && status && (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-sunken/70 px-5 py-4 text-sm">
          {status.accepted ? (
            <span>✓ You agreed to this version.</span>
          ) : (
            <>
              <span>{status.acceptedVersion ? `You agreed to version ${status.acceptedVersion}. This one changed: ${policy.summary}` : "You haven't agreed to this yet."}</span>
              <button onClick={agree} disabled={busy} className="rounded-full bg-ink px-4 py-2 font-semibold text-canvas disabled:opacity-60">
                {busy ? "Saving…" : "I agree"}
              </button>
            </>
          )}
        </div>
      )}

      <Card className="mt-6 p-6 sm:p-8">
        <Markdown source={policy.body} />
      </Card>

      <h2 className="mt-10 font-display text-lg font-bold">Every version</h2>
      <ul className="mt-3 divide-y divide-line rounded-2xl border border-line bg-surface">
        {policy.versions.map((v) => (
          <li key={v.version}>
            <button onClick={() => setVersion(v.version === policy.versions[0].version ? null : v.version)} className="flex w-full items-center gap-4 px-5 py-3 text-left text-sm hover:bg-sunken/60">
              <span className="w-10 font-mono text-ink-3">v{v.version}</span>
              <span className="flex-1">{v.summary}</span>
              <span className="text-ink-3">{new Date(v.publishedAt).toLocaleDateString()}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
