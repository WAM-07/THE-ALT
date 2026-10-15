"use client";
import { useEffect, useState } from "react";
import { Empty, ErrorNote, Heading, Loader } from "../../components/ui";
import { useStaff } from "../../components/Staff";
import { api } from "../../lib/alt";
import { short, stamp } from "../../lib/format";

const PAGE = 50;

export default function Audit() {
  const s = useStaff();
  const allowed = s.has("admin", "auditor");
  const [action, setAction] = useState("");
  const [entity, setEntity] = useState("");
  const [filters, setFilters] = useState({ action: "", entity: "" });
  const [rows, setRows] = useState([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(null);
  const [chain, setChain] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => setFilters({ action: action.trim(), entity: entity.trim() }), 300);
    return () => clearTimeout(t);
  }, [action, entity]);

  const url = (before) => {
    const p = new URLSearchParams({ limit: String(PAGE) });
    if (filters.action) p.set("action", filters.action);
    if (filters.entity) p.set("entityId", filters.entity);
    if (before) p.set("before", String(before));
    return `/core/admin/audit?${p}`;
  };

  useEffect(() => {
    if (!allowed) return;
    let live = true;
    setLoading(true);
    api(url())
      .then((r) => {
        if (!live) return;
        setRows(r);
        setMore(r.length === PAGE);
        setError(null);
      })
      .catch((e) => live && setError(e))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- url() reads only `filters`
  }, [filters, allowed]);

  useEffect(() => {
    if (allowed) api("/core/admin/audit/verify").then(setChain).catch(() => setChain(null));
  }, [allowed]);

  async function older() {
    setLoading(true);
    try {
      const r = await api(url(rows[rows.length - 1].id));
      setRows((cur) => [...cur, ...r]);
      setMore(r.length === PAGE);
    } catch (e) {
      setError(e);
    }
    setLoading(false);
  }

  if (!allowed) return <Heading n="04" eyebrow="Audit log" title="Admins and auditors only" lede="The audit log records every security-relevant action in ALT." />;

  return (
    <>
      <Heading n="04" eyebrow="Audit log" title="Every security-relevant action" lede="Sign-ins, role changes, money, ownership, moderation and every staff action, newest first. Each entry hashes the one before it, so nothing can be edited or removed unnoticed.">
        {chain && (chain.ok ? <span className="badge ok">Chain intact · {chain.checked} entries</span> : <span className="badge urgent">Chain broken at {chain.brokenAt}</span>)}
      </Heading>
      <ErrorNote error={error} />
      <section className="panel">
        <div className="filters">
          <input className="input" value={action} onChange={(e) => setAction(e.target.value)} placeholder="Action starts with… (e.g. case. or auth.login)" aria-label="Action" />
          <input className="input" value={entity} onChange={(e) => setEntity(e.target.value)} placeholder="Entity id (a case, person, AI…)" aria-label="Entity id" />
        </div>
        {loading && rows.length === 0 ? (
          <Loader />
        ) : rows.length === 0 ? (
          <Empty>No entries match</Empty>
        ) : (
          <div className="table-wrap">
            <table className="grid">
              <thead>
                <tr>
                  <th>Entry</th>
                  <th>When</th>
                  <th>Who</th>
                  <th>Action</th>
                  <th>On</th>
                  <th>Hash</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Entry key={r.id} r={r} open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="hint" style={{ borderTop: "1px solid var(--rule)", alignItems: "center" }}>
          <span>{rows.length} shown · click an entry for its details</span>
          {more && (
            <button className="btn" style={{ marginLeft: "auto", height: 28 }} onClick={older} disabled={loading}>
              Load older
            </button>
          )}
        </div>
      </section>
    </>
  );
}

function Entry({ r, open, onToggle }) {
  return (
    <>
      <tr aria-selected={open} onClick={onToggle}>
        <td className="num">{r.id}</td>
        <td className="num muted" style={{ whiteSpace: "nowrap" }}>
          {stamp(r.occurred_at)}
        </td>
        <td className="mono" style={{ fontSize: 12 }}>
          {r.actor_handle ? `@${r.actor_handle}` : r.actor_service ?? <span className="muted">system</span>}
        </td>
        <td className="mono" style={{ fontSize: 12 }}>
          {r.action}
        </td>
        <td className="mono muted" style={{ fontSize: 12 }}>
          {r.entity_type ? `${r.entity_type}:${short(r.entity_id)}` : "—"}
        </td>
        <td className="mono muted" style={{ fontSize: 12 }}>
          {short(r.hash, 10)}
        </td>
      </tr>
      {open && (
        <tr aria-selected="true" style={{ cursor: "default" }}>
          <td colSpan={6}>
            <pre className="data">{JSON.stringify({ entity: r.entity_type ? `${r.entity_type}:${r.entity_id}` : null, ip: r.ip, data: r.data, hash: r.hash }, null, 2)}</pre>
          </td>
        </tr>
      )}
    </>
  );
}
