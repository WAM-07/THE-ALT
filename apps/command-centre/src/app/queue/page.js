"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Empty, ErrorNote, Heading, KindBadge, Loader, PlatformBadge, Pri, StatusBadge } from "../../components/ui";
import { useStaff } from "../../components/Staff";
import { ago, caseNo, KIND, PLATFORM } from "../../lib/format";
import { useApi } from "../../lib/useApi";

const TABS = [
  ["active", "Active"],
  ["open", "Open"],
  ["in_progress", "In progress"],
  ["waiting", "Waiting"],
  ["closed", "Closed"],
  ["all", "All"],
];

export default function Queue() {
  const s = useStaff();
  const router = useRouter();
  const [status, setStatus] = useState("active");
  const [kind, setKind] = useState("");
  const [platform, setPlatform] = useState("");
  const [assignee, setAssignee] = useState("");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const search = useRef(null);

  // Search waits for a pause in typing.
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const params = new URLSearchParams({ status, limit: "100" });
  if (kind) params.set("kind", kind);
  if (platform) params.set("platform", platform);
  if (assignee) params.set("assignee", assignee);
  if (query) params.set("q", query);
  const list = useApi(`/core/staff/cases?${params}`);
  const items = useMemo(() => list.data?.items ?? [], [list.data]);

  // j / k move, Enter opens, / searches: a queue is worked from the keyboard.
  useEffect(() => {
    function onKey(e) {
      if (e.target.closest("input, textarea, select")) {
        if (e.key === "Escape") e.target.blur();
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        search.current?.focus();
      } else if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setSel((i) => Math.min(items.length - 1, i + 1));
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setSel((i) => Math.max(0, i - 1));
      } else if (e.key === "Enter" && items[sel]) {
        router.push(`/cases/${items[sel].id}`);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, sel, router]);

  useEffect(() => {
    document.querySelector('tr[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const reset = (fn) => (e) => {
    fn(e.target.value);
    setSel(0);
  };

  return (
    <>
      <Heading n="02" eyebrow="Queue" title="Cases" lede="Reports, automatic flags, support requests, disputes and appeals from every platform. Most urgent first, then most recently active." />
      <ErrorNote error={list.error} />
      <section className="panel">
        <div className="tabs" role="tablist" aria-label="Status">
          {TABS.map(([v, label]) => (
            <button
              key={v}
              role="tab"
              aria-selected={status === v}
              onClick={() => {
                setStatus(v);
                setSel(0);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="filters">
          <input ref={search} className="input" value={q} onChange={reset(setQ)} placeholder="Search titles, categories or #number" aria-label="Search" />
          <select className="select" value={kind} onChange={reset(setKind)} aria-label="Kind">
            <option value="">Every kind</option>
            {(s.staff?.sees ?? []).map((k) => (
              <option key={k} value={k}>
                {KIND[k]}
              </option>
            ))}
          </select>
          <select className="select" value={platform} onChange={reset(setPlatform)} aria-label="Platform">
            <option value="">Every platform</option>
            {["altera", "altar", "alter", "core"].map((p) => (
              <option key={p} value={p}>
                {PLATFORM[p]}
              </option>
            ))}
          </select>
          <select className="select" value={assignee} onChange={reset(setAssignee)} aria-label="Assignee">
            <option value="">Anyone</option>
            <option value="me">Mine</option>
            <option value="none">Unassigned</option>
          </select>
        </div>
        {list.loading && !list.data ? (
          <Loader />
        ) : items.length === 0 ? (
          <Empty>No cases match</Empty>
        ) : (
          <div className="table-wrap">
            <table className="grid">
              <thead>
                <tr>
                  <th aria-label="Priority" />
                  <th>No.</th>
                  <th>Case</th>
                  <th>Kind</th>
                  <th>From</th>
                  <th>Status</th>
                  <th>Reports</th>
                  <th>Assignee</th>
                  <th style={{ textAlign: "right" }}>Active</th>
                </tr>
              </thead>
              <tbody>
                {items.map((c, i) => (
                  <tr key={c.id} aria-selected={i === sel} onClick={() => router.push(`/cases/${c.id}`)} onMouseEnter={() => setSel(i)}>
                    <td style={{ width: 28 }}>
                      <Pri level={c.priority} />
                    </td>
                    <td className="num" style={{ width: 64 }}>
                      {caseNo(c.number)}
                    </td>
                    <td style={{ minWidth: 240 }}>
                      <Link className="t" href={`/cases/${c.id}`} onClick={(e) => e.stopPropagation()}>
                        {c.title}
                      </Link>
                      <span className="sub">
                        {c.category.replaceAll("_", " ")}
                        {c.subjectLabel ? ` · ${c.subjectLabel}` : c.subject ? ` · ${c.subject.type} ${c.subject.id.slice(0, 12)}` : ""}
                      </span>
                    </td>
                    <td>
                      <KindBadge kind={c.kind} />
                    </td>
                    <td>
                      <PlatformBadge platform={c.platform} />
                    </td>
                    <td>
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="num">{c.reports}</td>
                    <td className="mono" style={{ fontSize: 12 }}>
                      {c.assignee ? `@${c.assignee.handle}` : <span className="muted">—</span>}
                    </td>
                    <td className="num muted" style={{ textAlign: "right" }}>
                      {ago(c.updatedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="hint" style={{ borderTop: "1px solid var(--rule)" }}>
          <span>
            <kbd>j</kbd> <kbd>k</kbd> move
          </span>
          <span>
            <kbd>Enter</kbd> open
          </span>
          <span>
            <kbd>/</kbd> search
          </span>
          <span style={{ marginLeft: "auto" }}>{items.length} shown</span>
        </div>
      </section>
    </>
  );
}
