"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ErrorNote, Heading, KindBadge, Loader, Pri, StatusBadge } from "../components/ui";
import { useStaff } from "../components/Staff";
import { api } from "../lib/alt";
import { ago, caseNo, KIND, PLATFORM, STATUS } from "../lib/format";
import { useApi } from "../lib/useApi";

export default function Overview() {
  const s = useStaff();
  const router = useRouter();
  const summary = useApi("/core/staff/summary");
  const next = useApi("/core/staff/cases?status=active&limit=8");
  const sum = summary.data;
  // "3h" → 3 and "h"; nothing open → a dash.
  const age = sum?.oldestOpenAt ? ago(sum.oldestOpenAt) : null;
  const ageValue = !age ? "—" : age === "now" ? "0" : age.replace(/\D/g, "");
  const ageUnit = !age ? null : age === "now" ? "m" : age.replace(/\d/g, "");
  const maxKind = Math.max(1, ...Object.values(sum?.byKind ?? {}));
  const maxStatus = Math.max(1, ...Object.values(sum?.byStatus ?? {}));

  return (
    <>
      <Heading n="01" eyebrow="Overview" title={`Welcome back, ${s.user?.displayName ?? "staff"}`} lede="What is waiting for a person across ALTER, ALTERA and ALTAR, most urgent first.">
        <Link className="btn primary" href="/queue">
          Open the queue
        </Link>
      </Heading>
      <ErrorNote error={summary.error} />

      <div className="stats" role="list">
        <Stat label="Open" value={sum?.open} />
        <Stat label="Unassigned" value={sum?.unassigned} />
        <Stat label="Yours" value={sum?.mine} />
        <Stat label="High priority" value={sum?.highPriority} alert={sum?.highPriority > 0} />
        <Stat label="Oldest open" value={ageValue} unit={ageUnit} />
      </div>

      <div className="cols">
        <section className="panel">
          <h2 className="section">
            By kind <span className="aside">open cases</span>
          </h2>
          <ul className="bars">
            {(sum?.kinds ?? []).map((k) => (
              <Bar key={k} label={KIND[k]} n={sum.byKind[k] ?? 0} max={maxKind} />
            ))}
          </ul>
        </section>
        <section className="panel">
          <h2 className="section">
            By status <span className="aside">open cases</span>
          </h2>
          <ul className="bars">
            {Object.entries(sum?.byStatus ?? {}).map(([k, n]) => (
              <Bar key={k} label={STATUS[k]} n={n} max={maxStatus} />
            ))}
          </ul>
        </section>
      </div>

      <section className="panel" style={{ marginTop: 16 }}>
        <h2 className="section">
          Next up <span className="aside">urgent first, then most recent</span>
        </h2>
        {next.loading && !next.data ? (
          <Loader />
        ) : next.data?.items.length ? (
          <div className="table-wrap">
            <table className="grid">
              <tbody>
                {next.data.items.map((c) => (
                  <tr key={c.id} onClick={() => router.push(`/cases/${c.id}`)}>
                    <td style={{ width: 28 }}>
                      <Pri level={c.priority} />
                    </td>
                    <td className="num" style={{ width: 70 }}>
                      {caseNo(c.number)}
                    </td>
                    <td>
                      <Link className="t" href={`/cases/${c.id}`} onClick={(e) => e.stopPropagation()}>
                        {c.title}
                      </Link>
                      <span className="sub">
                        {PLATFORM[c.platform]} · {c.category.replaceAll("_", " ")}
                        {c.reports > 1 ? ` · ${c.reports} reports` : ""}
                      </span>
                    </td>
                    <td style={{ width: 90 }}>
                      <KindBadge kind={c.kind} />
                    </td>
                    <td style={{ width: 150 }}>
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="num muted" style={{ width: 50, textAlign: "right" }}>
                      {ago(c.updatedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">Nothing waiting. Every case is handled.</div>
        )}
      </section>

      {s.has("admin", "auditor") && <ChainCheck />}
    </>
  );
}

function Stat({ label, value, unit, alert }) {
  return (
    <div className={`stat${alert ? " alert" : ""}`} role="listitem">
      <span className="eyebrow">{label}</span>
      <span className="n">
        {value ?? "—"}
        {unit ? <small>{unit}</small> : null}
      </span>
    </div>
  );
}

function Bar({ label, n, max }) {
  return (
    <li>
      <span>{label}</span>
      <span className="track" aria-hidden="true">
        <span className={`fill${n ? "" : " zero"}`} style={{ width: `${(n / max) * 100}%`, display: "block" }} />
      </span>
      <span className="count num">{n}</span>
    </li>
  );
}

/** Re-checks the audit log's hash chain: every entry hashes the one before, so a changed or deleted entry shows. */
function ChainCheck() {
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function run() {
    setBusy(true);
    setError(null);
    try {
      setResult(await api("/core/admin/audit/verify"));
    } catch (e) {
      setError(e);
    }
    setBusy(false);
  }
  return (
    <section className="panel" style={{ marginTop: 16 }}>
      <h2 className="section">
        Audit chain <span className="aside">tamper check</span>
      </h2>
      <div className="pad" style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
        <button className="btn" onClick={run} disabled={busy}>
          {busy ? "Checking…" : "Verify now"}
        </button>
        {result &&
          (result.ok ? (
            <span>
              <span className="badge ok">Intact</span> <span className="num muted">{result.checked} entries re-hashed, none changed</span>
            </span>
          ) : (
            <span>
              <span className="badge urgent">Broken</span> <span className="num">at entry {result.brokenAt}</span>
            </span>
          ))}
        {!result && !error && <span className="muted">Every entry hashes the one before it, so a changed or deleted entry is caught.</span>}
        <ErrorNote error={error} />
      </div>
    </section>
  );
}
