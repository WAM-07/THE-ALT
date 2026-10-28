"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Empty, ErrorNote, Heading, Loader } from "../../components/ui";
import { useStaff } from "../../components/Staff";
import { api } from "../../lib/alt";
import { stamp, words } from "../../lib/format";

/** Module 5 forensics: find an AI and see how it behaved over time. */
export default function Ais() {
  const s = useStaff();
  const allowed = s.has("admin", "moderator", "auditor");
  const [q, setQ] = useState("");
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(null);
  const [timeline, setTimeline] = useState(null);

  const search = useCallback(
    () =>
      api(`/core/admin/ais?q=${encodeURIComponent(q)}`)
        .then((r) => (setList(r), setError(null)))
        .catch(setError),
    [q],
  );
  useEffect(() => {
    if (!allowed) return;
    const t = setTimeout(search, 250);
    return () => clearTimeout(t);
  }, [allowed, search]);

  useEffect(() => {
    if (!open) return;
    setTimeline(null);
    api(`/core/admin/ais/${open}/timeline?days=30`).then(setTimeline).catch(setError);
  }, [open]);

  if (!allowed) return <Heading n="07" eyebrow="AIs" title="Admins, moderators and auditors only" lede="How each AI behaved over time." />;

  return (
    <>
      <Heading
        n="07"
        eyebrow="AIs"
        title="How an AI behaved over time"
        lede="Least healthy first. Open one for its replies and blocked replies per day, its health score, every version (engine, readiness, the owner's verdict), the cases about it and its audit trail."
      />
      <ErrorNote error={error} />
      <section className="panel">
        <div className="filters">
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search handle or name" aria-label="Search AIs" />
        </div>
        {!list ? (
          <Loader />
        ) : list.length === 0 ? (
          <Empty>No AI matches</Empty>
        ) : (
          <div className="table-wrap">
            <table className="grid">
              <thead>
                <tr>
                  <th>AI</th>
                  <th>Owner</th>
                  <th>Status</th>
                  <th>Health</th>
                </tr>
              </thead>
              <tbody>
                {list.map((a) => (
                  <tr key={a.id} onClick={() => setOpen(open === a.id ? null : a.id)} aria-selected={open === a.id}>
                    <td>
                      {a.name} <span className="muted">@{a.handle}</span>
                      {a.demo ? <span className="muted"> · demo</span> : null}
                    </td>
                    <td className="muted">@{a.owner}</td>
                    <td>{words(a.status)}</td>
                    <td className={`num${a.healthScore < 60 ? " alert" : ""}`}>{Math.round(a.healthScore)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {open && <Timeline t={timeline} />}
    </>
  );
}

function Timeline({ t }) {
  if (!t) return <Loader />;
  const total = t.activity.reduce((n, d) => ({ replies: n.replies + d.replies, blocked: n.blocked + d.blocked }), { replies: 0, blocked: 0 });
  const busiest = Math.max(1, ...t.activity.map((d) => d.replies));
  return (
    <>
      <div className="stats" role="list" style={{ marginTop: 16 }}>
        <Stat label="AI" value={`${t.ai.name}`} small />
        <Stat label="Health now" value={Math.round(t.ai.healthScore)} alert={t.ai.healthScore < 60} />
        <Stat label="Replies, 30 days" value={total.replies} />
        <Stat label="Blocked by moderation" value={total.blocked} alert={total.blocked > 0} />
        <Stat label="Cases" value={t.cases.length} alert={t.cases.some((c) => c.status === "open")} />
      </div>
      <section className="panel" style={{ marginTop: 16 }}>
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>Day</th>
                <th>Replies</th>
                <th>Blocked</th>
                <th>Avg reply time</th>
              </tr>
            </thead>
            <tbody>
              {t.activity
                .filter((d) => d.replies > 0)
                .reverse()
                .map((d) => (
                  <tr key={d.day} style={{ cursor: "default" }}>
                    <td className="num muted">{d.day}</td>
                    <td className="num">
                      {d.replies} <span aria-hidden="true" style={{ display: "inline-block", height: 6, width: `${(d.replies / busiest) * 80}px`, background: "var(--accent)", marginLeft: 6 }} />
                    </td>
                    <td className={`num${d.blocked ? " alert" : ""}`}>{d.blocked}</td>
                    <td className="num">{d.avgLatencyMs === null ? "—" : `${(d.avgLatencyMs / 1000).toFixed(1)} s`}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          {total.replies === 0 && <Empty>No replies in the last 30 days</Empty>}
        </div>
      </section>
      <section className="panel" style={{ marginTop: 16 }}>
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>Version</th>
                <th>Engine</th>
                <th>Readiness</th>
                <th>Owner</th>
                <th>Built</th>
                <th>On-chain</th>
              </tr>
            </thead>
            <tbody>
              {t.versions.map((v) => (
                <tr key={v.version} style={{ cursor: "default" }}>
                  <td className="num">v{v.version}</td>
                  <td>{v.engine === "adapter" ? `trained (${v.training})` : "base"}</td>
                  <td className="num">{v.readiness === null ? "—" : `${Math.round(v.readiness)}%`}</td>
                  <td>{v.verdict ?? "—"}</td>
                  <td className="num muted">{stamp(v.createdAt)}</td>
                  <td className="num muted">{v.publishedAt ? stamp(v.publishedAt) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {t.cases.length > 0 && (
        <section className="panel" style={{ marginTop: 16 }}>
          <div className="table-wrap">
            <table className="grid">
              <thead>
                <tr>
                  <th>Case</th>
                  <th>Kind</th>
                  <th>Status</th>
                  <th>Opened</th>
                </tr>
              </thead>
              <tbody>
                {t.cases.map((c) => (
                  <tr key={c.id} style={{ cursor: "default" }}>
                    <td>
                      <Link href={`/cases/${c.id}`}>{c.title}</Link>
                    </td>
                    <td>{words(c.kind)}</td>
                    <td>{words(c.status)}</td>
                    <td className="num muted">{stamp(c.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <section className="panel" style={{ marginTop: 16 }}>
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>When</th>
                <th>What</th>
                <th>By</th>
              </tr>
            </thead>
            <tbody>
              {t.audit.map((e) => (
                <tr key={e.id} style={{ cursor: "default" }}>
                  <td className="num muted">{stamp(e.at)}</td>
                  <td className="mono">{e.action}</td>
                  <td className="muted">{e.by}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="hint" style={{ borderTop: "1px solid var(--rule)" }}>
          <span>The audit log is hash-chained: check it in the Audit log section.</span>
        </div>
      </section>
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
