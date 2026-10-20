"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Empty, ErrorNote, Heading, Loader } from "../../components/ui";
import { useStaff } from "../../components/Staff";
import { api } from "../../lib/alt";
import { stamp, words } from "../../lib/format";

const STATUS = { done: "Done", not_enough_data: "Not enough history yet", unavailable: "ML service unavailable" };

export default function Behaviour() {
  const s = useStaff();
  const allowed = s.has("admin", "moderator", "auditor");
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [running, setRunning] = useState(false);
  const [open, setOpen] = useState(null);

  const load = useCallback(() => api("/core/admin/behaviour").then(setData).catch(setError), []);
  useEffect(() => {
    if (allowed) load();
  }, [allowed, load]);

  async function scanNow() {
    setRunning(true);
    try {
      await api("/core/admin/behaviour/scan", { method: "POST" });
      await load();
      setError(null);
    } catch (e) {
      setError(e);
    }
    setRunning(false);
  }

  if (!allowed) return <Heading n="06" eyebrow="Unusual activity" title="Admins, moderators and auditors only" lede="ALT's behaviour model looks for accounts acting unlike ALT's usual accounts." />;

  const latest = data?.scans[0];
  return (
    <>
      <Heading
        n="06"
        eyebrow="Unusual activity"
        title="What the behaviour model saw"
        lede={`Once a day, each account's last 24 hours (sign-ins, failed sign-ins, IP addresses, password and wallet changes, messages, items, rentals) is compared with ALT's accounts over the 30 days before, by an Isolation Forest and a per-feature extremeness check retrained on every scan. Unusual accounts become flag cases in the queue; nothing happens to the account itself.`}
      >
        {s.has("admin") && (
          <button className="btn" onClick={scanNow} disabled={running}>
            {running ? "Scanning…" : "Scan now"}
          </button>
        )}
      </Heading>
      <ErrorNote error={error} />
      {!data ? (
        <Loader />
      ) : !latest ? (
        <Empty>No scan yet. The first runs a minute after ALT Core starts with its ML service.</Empty>
      ) : (
        <>
          <div className="stats" role="list">
            <Stat label="Last scan" value={stamp(latest.ranAt)} small />
            <Stat label="Result" value={STATUS[latest.status] ?? latest.status} small />
            <Stat label="Active days learned" value={latest.trainedRows} unit={latest.status === "not_enough_data" ? ` / ${data.minTrainingDays}` : ""} />
            <Stat label="Accounts scored" value={latest.scored} />
            <Stat label="Unusual" value={latest.flagged} alert={latest.flagged > 0} />
          </div>
          <section className="panel" style={{ marginTop: 16 }}>
            {latest.results.length === 0 ? (
              <Empty>{latest.status === "done" ? "No activity in the last 24 hours" : "Nothing was scored in this scan"}</Empty>
            ) : (
              <div className="table-wrap">
                <table className="grid">
                  <thead>
                    <tr>
                      <th>Account</th>
                      <th>Verdict</th>
                      <th>Forest score</th>
                      <th>Extremeness</th>
                      <th>Stood out</th>
                    </tr>
                  </thead>
                  <tbody>
                    {latest.results.map((r) => (
                      <Row key={r.userId} r={r} t={latest.thresholds} open={open === r.userId} onToggle={() => setOpen(open === r.userId ? null : r.userId)} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="hint" style={{ borderTop: "1px solid var(--rule)" }}>
              <span>
                {latest.model ?? "No model run"}
                {latest.thresholds ? ` · thresholds: forest ${latest.thresholds.forest}, extremeness ${latest.thresholds.extreme} (each the top 0.5% of the days learned)` : ""} · click an account for its counts ·{" "}
                <Link href="/queue">flag cases are in the queue</Link>
              </span>
            </div>
          </section>
          {data.scans.length > 1 && (
            <section className="panel" style={{ marginTop: 16 }}>
              <div className="table-wrap">
                <table className="grid">
                  <thead>
                    <tr>
                      <th>Earlier scans</th>
                      <th>Result</th>
                      <th>Days learned</th>
                      <th>Scored</th>
                      <th>Unusual</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.scans.slice(1).map((x) => (
                      <tr key={x.id} style={{ cursor: "default" }}>
                        <td className="num muted">{stamp(x.ranAt)}</td>
                        <td>{STATUS[x.status] ?? x.status}</td>
                        <td className="num">{x.trainedRows}</td>
                        <td className="num">{x.scored}</td>
                        <td className="num">{x.flagged}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </>
  );
}

function Row({ r, t, open, onToggle }) {
  return (
    <>
      <tr aria-selected={open} onClick={onToggle}>
        <td className="mono" style={{ fontSize: 12 }}>
          {r.user ? `@${r.user.handle}` : r.userId.slice(0, 8)}
          {r.user?.displayName ? <span className="muted"> · {r.user.displayName}</span> : null}
        </td>
        <td>{r.unusual ? <span className="badge urgent">Unusual</span> : <span className="badge">Ordinary</span>}</td>
        <td className="num" style={{ color: t && r.score >= t.forest ? "var(--urgent)" : undefined }}>
          {r.score.toFixed(3)}
        </td>
        <td className="num" style={{ color: t && r.extreme >= t.extreme ? "var(--urgent)" : undefined }}>
          {r.extreme.toFixed(2)}
        </td>
        <td style={{ fontSize: 13 }}>{r.reasons.length ? r.reasons.map(words).join(", ") : <span className="muted">—</span>}</td>
      </tr>
      {open && (
        <tr aria-selected="true" style={{ cursor: "default" }}>
          <td colSpan={5}>
            <pre className="data">{JSON.stringify(r.features, null, 2)}</pre>
          </td>
        </tr>
      )}
    </>
  );
}

function Stat({ label, value, unit, alert, small }) {
  return (
    <div className={`stat${alert ? " alert" : ""}`} role="listitem">
      <span className="eyebrow">{label}</span>
      <span className="n" style={small ? { fontSize: 15, marginTop: 14 } : undefined}>
        {value ?? "—"}
        {unit ? <small>{unit}</small> : null}
      </span>
    </div>
  );
}
