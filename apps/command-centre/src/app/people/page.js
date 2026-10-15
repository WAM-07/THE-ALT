"use client";
import { useEffect, useState } from "react";
import { Empty, ErrorNote, Heading, Loader } from "../../components/ui";
import { useStaff } from "../../components/Staff";
import { api } from "../../lib/alt";
import { ROLES, stamp, STAFF_ROLES } from "../../lib/format";
import { useApi } from "../../lib/useApi";

const ROLE_HELP = {
  admin: "everything, including roles",
  moderator: "reports, flags, appeals",
  support: "requests, disputes",
  auditor: "reads everything, changes nothing",
  creator: "makes AIs",
  consumer: "buys or rents AIs",
  participant: "uses the platforms",
};

export default function People() {
  const s = useStaff();
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(null);
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const isAdmin = s.has("admin");
  const list = useApi(isAdmin ? `/core/admin/users?limit=100${query ? `&q=${encodeURIComponent(query)}` : ""}` : null);

  if (!isAdmin)
    return (
      <>
        <Heading n="03" eyebrow="People" title="Admins only" lede="Only admins look up accounts and give or take staff roles." />
      </>
    );

  const users = list.data ?? [];
  return (
    <>
      <Heading n="03" eyebrow="People" title="Accounts and staff roles" lede="Find any ALT account, see its roles and 2FA, give or take staff roles, and clear a sign-in lockout. Every change is audited." />
      <ErrorNote error={list.error} />
      <section className="panel">
        <div className="filters">
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search handle, name or email" aria-label="Search people" />
        </div>
        {list.loading && !list.data ? (
          <Loader />
        ) : users.length === 0 ? (
          <Empty>Nobody matches</Empty>
        ) : (
          <div className="table-wrap">
            <table className="grid">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Email</th>
                  <th>Roles</th>
                  <th>2FA</th>
                  <th>Joined</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <Row key={u.id} u={u} open={open === u.id} onToggle={() => setOpen(open === u.id ? null : u.id)} self={u.id === s.user?.id} reload={list.reload} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function Row({ u, open, onToggle, self, reload }) {
  const staff = u.roles.filter((r) => STAFF_ROLES.includes(r));
  const locked = u.locked_until && new Date(u.locked_until) > new Date();
  return (
    <>
      <tr aria-selected={open} onClick={onToggle}>
        <td>
          <span className="t">{u.display_name}</span>
          <span className="sub">@{u.handle}</span>
        </td>
        <td className="mono" style={{ fontSize: 12 }}>
          {u.email}
        </td>
        <td>
          <div className="badges">
            {staff.map((r) => (
              <span key={r} className="badge accent">
                {r}
              </span>
            ))}
            {u.roles
              .filter((r) => !STAFF_ROLES.includes(r))
              .map((r) => (
                <span key={r} className="badge">
                  {r}
                </span>
              ))}
            {locked && <span className="badge urgent">locked</span>}
            {u.deleted_at && <span className="badge">deleted</span>}
          </div>
        </td>
        <td className="mono">{u.two_fa_enabled ? <span className="badge ok">on</span> : <span className="muted">off</span>}</td>
        <td className="num muted">{stamp(u.created_at).slice(0, 10)}</td>
      </tr>
      {open && (
        <tr aria-selected="true" style={{ cursor: "default" }}>
          <td colSpan={5} onClick={(e) => e.stopPropagation()}>
            <RoleEditor u={u} self={self} locked={locked} reload={reload} />
          </td>
        </tr>
      )}
    </>
  );
}

function RoleEditor({ u, self, locked, reload }) {
  const [roles, setRoles] = useState(u.roles);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const changed = [...roles].sort().join() !== [...u.roles].sort().join();
  const toggle = (r) => {
    setSaved(false);
    setRoles((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]));
  };
  async function act(fn) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setSaved(true);
      reload();
    } catch (e) {
      setError(e);
    }
    setBusy(false);
  }
  return (
    <div style={{ padding: "6px 0 4px" }}>
      <ErrorNote error={error} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 4 }}>
        {ROLES.map((r) => (
          <label key={r} className="check" style={{ margin: 0 }}>
            {/* An admin can't remove their own admin role here, so the Command Centre is never left without one by accident. */}
            <input type="checkbox" checked={roles.includes(r)} disabled={busy || (self && r === "admin")} onChange={() => toggle(r)} />
            <span>
              <b className="mono" style={{ fontWeight: 500 }}>
                {r}
              </b>{" "}
              <span className="muted">· {ROLE_HELP[r]}</span>
            </span>
          </label>
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12, alignItems: "center" }}>
        <button className="btn primary" disabled={busy || !changed || roles.length === 0} onClick={() => act(() => api(`/core/admin/users/${u.id}/roles`, { method: "PUT", body: { roles } }))}>
          Save roles
        </button>
        {locked && (
          <button className="btn" disabled={busy} onClick={() => act(() => api(`/core/admin/users/${u.id}/unlock`, { method: "POST" }))}>
            Clear lockout
          </button>
        )}
        {saved && !changed && <span className="mono muted" style={{ fontSize: 12 }}>Saved. It applies the next time they sign in or their session refreshes.</span>}
      </div>
    </div>
  );
}
