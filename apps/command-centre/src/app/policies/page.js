"use client";
import { useState } from "react";
import Markdown from "../../components/Markdown";
import { ErrorNote, Heading, Loader } from "../../components/ui";
import { useStaff } from "../../components/Staff";
import { api } from "../../lib/alt";
import { stamp } from "../../lib/format";
import { useApi } from "../../lib/useApi";

// M3 FE-5: ALT's ecosystem-wide policies. Every version is kept; people are asked to agree to the
// current one in every app, and this page shows how many have.
export default function Policies() {
  const s = useStaff();
  const res = useApi("/core/staff/policies");
  const [slug, setSlug] = useState("terms");
  const [editing, setEditing] = useState(false);
  const items = res.data?.items ?? [];
  const p = items.find((x) => x.slug === slug);

  return (
    <>
      <Heading
        n="05"
        eyebrow="Policies"
        title="Terms, privacy and the AI content policy"
        lede="The rules everyone on ALTER, ALTERA and ALTAR agrees to. Publishing a new version asks everyone to agree again; every version stays readable at /legal."
      />
      <ErrorNote error={res.error} />
      {res.loading && !res.data ? (
        <Loader />
      ) : (
        <>
          <div className="stats" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
            {items.map((x) => (
              <button key={x.slug} className={`stat stat-pick${x.slug === slug ? " on" : ""}`} onClick={() => (setSlug(x.slug), setEditing(false))}>
                <span className="eyebrow">{x.title}</span>
                <span className="n">
                  v{x.version}
                  <small>
                    {" "}
                    · {x.accepted}/{res.data.people} agreed
                  </small>
                </span>
              </button>
            ))}
          </div>

          {p && (
            <div className="split" style={{ marginTop: 16 }}>
              <div className="stack">
                {editing ? (
                  <Publish policy={p} onDone={() => (setEditing(false), res.reload())} />
                ) : (
                  <section className="panel">
                    <h2 className="section">
                      {p.title} · v{p.version} <span className="aside">current</span>
                    </h2>
                    <div className="pad">
                      <Markdown source={p.body} />
                    </div>
                  </section>
                )}
              </div>
              <aside className="stack">
                <section className="panel">
                  <h2 className="section">Versions</h2>
                  <div className="table-wrap">
                    <table className="grid">
                      <thead>
                        <tr>
                          <th>v</th>
                          <th>What changed</th>
                          <th style={{ textAlign: "right" }}>Agreed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {p.versions.map((v) => (
                          <tr key={v.version} style={{ cursor: "default" }}>
                            <td className="num">{v.version}</td>
                            <td>
                              {v.summary}
                              <span className="sub">
                                {stamp(v.publishedAt).slice(0, 10)} · {v.publishedBy}
                              </span>
                            </td>
                            <td className="num" style={{ textAlign: "right" }}>
                              {v.accepted}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
                <section className="panel">
                  <div className="pad">
                    {s.has("admin") ? (
                      <button className="btn primary wide" onClick={() => setEditing(!editing)}>
                        {editing ? "Back to the current version" : `Publish version ${p.version + 1}`}
                      </button>
                    ) : (
                      <p className="muted" style={{ margin: 0 }}>
                        Only admins publish policies.
                      </p>
                    )}
                    <p className="muted" style={{ fontSize: 12.5, margin: "10px 0 0" }}>
                      Public page:{" "}
                      <a href={`/legal/${p.slug}`} target="_blank" rel="noreferrer" className="mono">
                        /legal/{p.slug}
                      </a>
                    </p>
                  </div>
                </section>
              </aside>
            </div>
          )}
        </>
      )}
    </>
  );
}

function Publish({ policy, onDone }) {
  const [title, setTitle] = useState(policy.title);
  const [summary, setSummary] = useState("");
  const [body, setBody] = useState(policy.body);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function publish(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/core/staff/policies/${policy.slug}`, { method: "POST", body: { title, summary, body } });
      onDone();
    } catch (err) {
      setError(err);
    }
    setBusy(false);
  }
  return (
    <section className="panel">
      <h2 className="section">
        New version of {policy.title} <span className="aside">v{policy.version + 1}</span>
      </h2>
      <form className="pad" onSubmit={publish}>
        <ErrorNote error={error} />
        <label className="field">
          <span>Title</span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
        </label>
        <label className="field">
          <span>What changed (people see this first)</span>
          <input className="input" value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={500} placeholder="e.g. Rentals now last whole days." />
        </label>
        <div className="tabs" role="tablist" style={{ marginBottom: 10 }}>
          <button type="button" role="tab" aria-selected={!preview} onClick={() => setPreview(false)}>
            Write
          </button>
          <button type="button" role="tab" aria-selected={preview} onClick={() => setPreview(true)}>
            Preview
          </button>
        </div>
        {preview ? (
          <div style={{ border: "1px solid var(--rule)", padding: 14, background: "var(--canvas)" }}>
            <Markdown source={body} />
          </div>
        ) : (
          <textarea className="textarea mono" style={{ minHeight: 360, fontSize: 12.5 }} value={body} onChange={(e) => setBody(e.target.value)} maxLength={50000} aria-label="Policy text (Markdown)" />
        )}
        <p className="muted" style={{ fontSize: 12.5 }}>
          Markdown: <code>## heading</code>, <code>- list item</code>, <code>**bold**</code>, <code>*italic*</code>, <code>[link](https://…)</code>. Publishing notifies everyone and asks them to agree again in every app.
        </p>
        <button className="btn primary" disabled={busy || summary.trim().length < 3 || body.trim().length < 20}>
          {busy ? "Publishing…" : `Publish v${policy.version + 1}`}
        </button>
      </form>
    </section>
  );
}
