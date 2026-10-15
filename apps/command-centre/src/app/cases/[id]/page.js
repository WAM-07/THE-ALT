"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ErrorNote, KindBadge, Loader, PlatformBadge, Pri, StatusBadge } from "../../../components/ui";
import { useStaff } from "../../../components/Staff";
import { api } from "../../../lib/alt";
import { ago, caseNo, PLATFORM, PRIORITY, stamp, STATUS, words } from "../../../lib/format";
import { useApi } from "../../../lib/useApi";

const ACTION_DONE = {
  suspend_ai: "suspended the AI on-chain",
  unsuspend_ai: "lifted the AI's suspension",
  remove_content: "removed the content",
  warn_user: "warned the person",
  lock_account: "locked the person's account",
  unlock_account: "unlocked the person's account",
};
const ACTION_ASK = {
  suspend_ai: "Suspend this AI on-chain",
  unsuspend_ai: "Lift the AI's suspension",
  remove_content: "Remove it from the platform",
  warn_user: "Warn this person",
  lock_account: "Lock this person's account",
  unlock_account: "Unlock this person's account",
};
const LOCK_FOR = [
  [1, "1 day"],
  [7, "7 days"],
  [30, "30 days"],
  [null, "Until lifted"],
];

const VISIBILITY = { staff: ["Staff only", "accent"], author: ["Its author + staff", ""], participants: ["Shared with people", "ok"] };
const OPEN = ["open", "in_progress", "waiting"];

export default function CasePage() {
  const { id } = useParams();
  const s = useStaff();
  const res = useApi(`/core/staff/cases/${id}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (res.loading && !res.data) return <Loader>Loading case</Loader>;
  if (!res.data)
    return (
      <>
        <ErrorNote error={res.error} />
        <Link className="btn" href="/queue">
          Back to the queue
        </Link>
      </>
    );

  const { case: c, events, canHandle, targets, appealOf, appeals } = res.data;
  const open = OPEN.includes(c.status);
  const mine = c.assignee?.id === s.user?.id;

  /** Runs one change, then reloads the case; errors show above the actions. */
  async function run(path, body, method = "POST") {
    setBusy(true);
    setError(null);
    try {
      await api(`/core/staff/cases/${c.id}${path}`, { method, body });
      res.reload();
      return true;
    } catch (e) {
      setError(e);
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="case-head">
        <div className="case-no num">{caseNo(c.number)}</div>
        <div style={{ minWidth: 0 }}>
          <div className="eyebrow">
            <Link href="/queue" style={{ textDecoration: "none" }}>
              <b>02</b> / Queue
            </Link>{" "}
            / {words(c.category)}
          </div>
          <h1 className="title" style={{ marginTop: 6 }}>
            {c.title}
          </h1>
          <div className="badges" style={{ marginTop: 10 }}>
            <StatusBadge status={c.status} />
            <span className="badge">
              <Pri level={c.priority} /> {PRIORITY[c.priority]}
            </span>
            <KindBadge kind={c.kind} />
            <PlatformBadge platform={c.platform} />
            {c.reports > 1 && <span className="badge urgent">{c.reports} reports</span>}
          </div>
        </div>
      </div>

      {appealOf && (
        <section className="panel" style={{ marginBottom: 16, borderLeft: "3px solid var(--accent)" }}>
          <h2 className="section">
            Appeal of <Link href={`/cases/${appealOf.id}`}>{caseNo(appealOf.number)}</Link> <span className="aside">{appealOf.title}</span>
          </h2>
          <div className="pad">
            {appealOf.decisions.length ? (
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {appealOf.decisions.map((d, i) => (
                  <li key={i}>
                    <b>{ACTION_DONE[d.action] ?? d.action}</b> by <span className="mono">@{d.by ?? "staff"}</span> on {stamp(d.at)}: {d.reason}
                  </li>
                ))}
              </ul>
            ) : (
              <span className="muted">No action was taken on that case.</span>
            )}
            <p className="muted" style={{ fontSize: 12.5, margin: "10px 0 0" }}>Whoever took that decision can&apos;t judge this appeal. To overturn it, use Take action (lift, unlock), then close this case.</p>
          </div>
        </section>
      )}
      {appeals?.length > 0 && (
        <p className="mono" style={{ fontSize: 12, margin: "0 0 12px" }}>
          Appealed in{" "}
          {appeals.map((a, i) => (
            <span key={a.id}>
              {i > 0 && ", "}
              <Link href={`/cases/${a.id}`}>{caseNo(a.number)}</Link> ({STATUS[a.status]})
            </span>
          ))}
        </p>
      )}

      <div className="split">
        <div className="stack">
          <section className="panel">
            <h2 className="section">
              History <span className="aside">{events.length} entries · oldest first</span>
            </h2>
            <ol className="timeline">
              {events.map((e) => (
                <Event key={e.id} e={e} />
              ))}
            </ol>
          </section>
          {canHandle && open && <Composer kind={c.kind} busy={busy} run={run} />}
        </div>

        <aside className="stack">
          <section className="panel">
            <h2 className="section">Details</h2>
            <dl className="kv">
              <dt>Kind</dt>
              <dd>{words(c.kind)}</dd>
              <dt>From</dt>
              <dd>{PLATFORM[c.platform]}</dd>
              <dt>Category</dt>
              <dd>{words(c.category)}</dd>
              <dt>About</dt>
              <dd>
                {c.subject ? (
                  <>
                    {c.subjectLabel && <div>{c.subjectLabel}</div>}
                    <span className="mono muted" style={{ fontSize: 12 }}>
                      {c.subject.type} · {c.subject.id}
                    </span>
                  </>
                ) : (
                  <span className="muted">Nothing specific</span>
                )}
              </dd>
              <dt>Opened by</dt>
              <dd className="mono">{c.openedBy ? `@${c.openedBy.handle}` : <span className="muted">a platform (automatic)</span>}</dd>
              <dt>Assignee</dt>
              <dd className="mono">{c.assignee ? `@${c.assignee.handle}` : <span className="muted">nobody yet</span>}</dd>
              <dt>Opened</dt>
              <dd className="mono">
                {stamp(c.createdAt)} <span className="muted">({ago(c.createdAt)})</span>
              </dd>
              <dt>Last activity</dt>
              <dd className="mono">{stamp(c.updatedAt)}</dd>
              {c.closedAt && (
                <>
                  <dt>Closed</dt>
                  <dd className="mono">{stamp(c.closedAt)}</dd>
                </>
              )}
            </dl>
          </section>

          {canHandle && <TakeAction targets={targets} busy={busy} run={run} />}

          <section className="panel">
            <h2 className="section">Case</h2>
            <div className="pad">
              <ErrorNote error={error} />
              {!canHandle ? (
                <p className="muted" style={{ margin: 0 }}>
                  View only. Either your role doesn&apos;t handle {words(c.kind)} cases, or you are involved in this one (you opened it, reported it, or it is about
                  you), so another member of staff must decide it.
                </p>
              ) : open ? (
                <OpenActions c={c} mine={mine} busy={busy} run={run} />
              ) : (
                <>
                  <p style={{ marginTop: 0 }}>
                    <StatusBadge status={c.status} />
                  </p>
                  <p className="muted">{c.resolution}</p>
                  <button className="btn" disabled={busy} onClick={() => run("", { status: "open" }, "PATCH")}>
                    Reopen
                  </button>
                </>
              )}
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}

function Event({ e }) {
  const [label, tone] = VISIBILITY[e.visibility] ?? [e.visibility, ""];
  const who = e.actor?.handle ? `@${e.actor.handle}` : e.actor?.service ? e.actor.service : "ALT";
  const d = e.data ?? {};
  const what = {
    opened: "opened the case",
    reported: "added a report",
    message: "wrote",
    reply: "replied to the people on the case",
    note: "left an internal note",
    status: `changed status: ${STATUS[d.from] ?? d.from} → ${STATUS[d.to] ?? d.to}`,
    priority: `changed priority: ${PRIORITY[d.from] ?? d.from} → ${PRIORITY[d.to] ?? d.to}`,
    assigned: d.to ? (d.to === e.actor?.userId ? "took the case" : "assigned the case") : "unassigned the case",
    action: ACTION_DONE[d.action] ?? `took action: ${d.action}`,
  }[e.kind];
  return (
    <li className={e.visibility === "staff" ? "staff" : undefined}>
      <div className="when">
        {stamp(e.at).slice(0, 10)}
        <br />
        {stamp(e.at).slice(11)}
      </div>
      <div className="what">
        <div className="who">
          <b className="mono">{who}</b> {what}
          {d.category && e.kind === "reported" ? <span className="muted">· {words(d.category)}</span> : null}
          <span className={`badge ${tone}`} style={{ marginLeft: "auto" }}>
            {label}
          </span>
        </div>
        {e.body && <p className="body">{e.body}</p>}
        {e.kind === "action" && d.txHash && (
          <p className="mono muted" style={{ fontSize: 11.5, margin: "6px 0 0" }}>
            on-chain: {d.explorer ? <a href={d.explorer} target="_blank" rel="noreferrer">{d.txHash}</a> : d.txHash}
          </p>
        )}
        {d.evidence && (
          <div className="evidence">
            <div className="eyebrow" style={{ padding: "8px 12px 0" }}>
              Evidence · snapshot when reported
            </div>
            <pre className="data">{JSON.stringify(d.evidence, null, 2)}</pre>
          </div>
        )}
      </div>
    </li>
  );
}

function Composer({ kind, busy, run }) {
  // Automatic flags have nobody to answer; only notes.
  const canReply = kind !== "flag";
  const [mode, setMode] = useState(canReply ? "reply" : "note");
  const [text, setText] = useState("");
  const [wait, setWait] = useState(false);
  async function send(e) {
    e.preventDefault();
    if (!text.trim()) return;
    const ok = mode === "reply" ? await run("/reply", { body: text, waitForAnswer: wait }) : await run("/notes", { body: text });
    if (ok) {
      setText("");
      setWait(false);
    }
  }
  return (
    <section className="panel">
      <div className="tabs" role="tablist">
        {canReply && (
          <button role="tab" aria-selected={mode === "reply"} onClick={() => setMode("reply")}>
            Reply to people
          </button>
        )}
        <button role="tab" aria-selected={mode === "note"} onClick={() => setMode("note")}>
          Internal note
        </button>
      </div>
      <form className="pad" onSubmit={send}>
        <textarea
          className="textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={5000}
          placeholder={mode === "reply" ? "They see this signed “ALT”, in the app and in their inbox." : "Only staff see notes."}
          aria-label={mode === "reply" ? "Reply" : "Note"}
        />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", marginTop: 10 }}>
          {mode === "reply" && (
            <label className="check" style={{ margin: 0 }}>
              <input type="checkbox" checked={wait} onChange={(e) => setWait(e.target.checked)} /> Wait for their answer
            </label>
          )}
          <button className="btn primary" style={{ marginLeft: "auto" }} disabled={busy || !text.trim()}>
            {mode === "reply" ? "Send reply" : "Add note"}
          </button>
        </div>
      </form>
    </section>
  );
}

function OpenActions({ c, mine, busy, run }) {
  const [outcome, setOutcome] = useState("resolved");
  const [resolution, setResolution] = useState("");
  const [tell, setTell] = useState(true);
  return (
    <>
      <button className="btn wide" disabled={busy} onClick={() => run("/assign", mine ? { assigneeId: null } : {})}>
        {mine ? "Put it back in the queue" : c.assignee ? "Take it over" : "Take this case"}
      </button>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
        <label className="field" style={{ margin: 0 }}>
          <span>Status</span>
          <select className="select" value={c.status} disabled={busy} onChange={(e) => run("", { status: e.target.value }, "PATCH")}>
            {OPEN.map((x) => (
              <option key={x} value={x}>
                {STATUS[x]}
              </option>
            ))}
          </select>
        </label>
        <label className="field" style={{ margin: 0 }}>
          <span>Priority</span>
          <select className="select" value={c.priority} disabled={busy} onChange={(e) => run("", { priority: e.target.value }, "PATCH")}>
            {["urgent", "high", "normal", "low"].map((x) => (
              <option key={x} value={x}>
                {PRIORITY[x]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <form
        style={{ borderTop: "1px solid var(--rule)", marginTop: 14, paddingTop: 14 }}
        onSubmit={async (e) => {
          e.preventDefault();
          if (await run("/resolve", { outcome, resolution, notifyPeople: tell })) setResolution("");
        }}
      >
        <div className="eyebrow" style={{ marginBottom: 10 }}>
          Close the case
        </div>
        <div className="tabs" role="radiogroup" style={{ marginBottom: 10 }}>
          {[
            ["resolved", "Resolved"],
            ["dismissed", "Dismissed"],
          ].map(([v, l]) => (
            <button key={v} type="button" role="radio" aria-checked={outcome === v} onClick={() => setOutcome(v)}>
              {l}
            </button>
          ))}
        </div>
        <label className="field">
          <span>What was decided</span>
          <textarea
            className="textarea"
            style={{ minHeight: 80 }}
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
            maxLength={2000}
            placeholder={outcome === "resolved" ? "e.g. The post was removed and the AI warned." : "e.g. Reviewed: this doesn't break the AI content policy."}
          />
        </label>
        <label className="check">
          <input type="checkbox" checked={tell} onChange={(e) => setTell(e.target.checked)} /> Tell the people on the case
        </label>
        <button className={`btn wide ${outcome === "resolved" ? "primary" : "danger"}`} disabled={busy || resolution.trim().length < 3}>
          {outcome === "resolved" ? "Close as resolved" : "Dismiss"}
        </button>
      </form>
    </>
  );
}

/**
 * What staff can do about what the case is about: the AI (suspend on-chain), the post, comment or
 * review (remove it, through the platform that owns it), the person (warn, lock). Each needs a
 * reason, which the person affected is told; reporters hear the outcome when the case is closed.
 */
function TakeAction({ targets, busy, run }) {
  const s = useStaff();
  const [open, setOpen] = useState(null); // the action being confirmed
  const [reason, setReason] = useState("");
  const [days, setDays] = useState(7);
  const [done, setDone] = useState(null);
  const moderates = s.has("admin", "moderator");
  const { ai, person, content } = targets ?? {};
  if (!ai && !person && !content) return null;

  async function confirm(e) {
    e.preventDefault();
    const body = { action: open, reason, ...(open === "lock_account" ? { days } : {}) };
    if (await run("/actions", body)) {
      setDone(ACTION_DONE[open]);
      setOpen(null);
      setReason("");
    }
  }

  const ask = (action) => () => {
    setDone(null);
    setOpen(open === action ? null : action);
  };
  const destructive = ["suspend_ai", "remove_content", "lock_account"].includes(open);

  return (
    <section className="panel">
      <h2 className="section">
        Take action <span className="aside">each one is audited</span>
      </h2>
      <div className="pad">
        {ai && (
          <div className="act-row">
            <div>
              <div className="eyebrow">AI</div>
              <b>{ai.name}</b> <span className="mono muted">@{ai.handle}</span>
              <div className="badges" style={{ marginTop: 6 }}>
                {ai.suspended ? <span className="badge urgent">Suspended</span> : <span className="badge">{ai.status}</span>}
                {ai.tokenId && <span className="badge">AIT #{ai.tokenId}</span>}
              </div>
            </div>
            {moderates && ai.tokenId && (
              <button className={`btn ${ai.suspended ? "" : "danger"}`} disabled={busy || !targets.canSuspendOnChain} onClick={ask(ai.suspended ? "unsuspend_ai" : "suspend_ai")} title={targets.canSuspendOnChain ? undefined : "ALT has no governor key configured"}>
                {ai.suspended ? "Lift suspension" : "Suspend on-chain"}
              </button>
            )}
          </div>
        )}
        {content && moderates && (
          <div className="act-row">
            <div>
              <div className="eyebrow">Reported {content.type}</div>
              <span className="mono muted" style={{ fontSize: 12 }}>
                {content.platform.toUpperCase()} · {content.id.slice(0, 18)}
              </span>
            </div>
            <button className="btn danger" disabled={busy} onClick={ask("remove_content")}>
              Remove it
            </button>
          </div>
        )}
        {person && (
          <div className="act-row">
            <div>
              <div className="eyebrow">{ai ? "Its owner" : "Person"}</div>
              <b>{person.displayName}</b> <span className="mono muted">@{person.handle}</span>
              <div className="badges" style={{ marginTop: 6 }}>
                <span className={`badge ${person.warnings ? "urgent" : ""}`}>
                  {person.warnings} {person.warnings === 1 ? "warning" : "warnings"}
                </span>
                {person.lockedUntil && <span className="badge urgent">Locked until {stamp(person.lockedUntil).slice(0, 10)}</span>}
                {person.staff && <span className="badge accent">Staff</span>}
              </div>
            </div>
            <div className="act-buttons">
              <button className="btn" disabled={busy} onClick={ask("warn_user")}>
                Warn
              </button>
              {moderates &&
                (person.lockedUntil ? (
                  <button className="btn" disabled={busy} onClick={ask("unlock_account")}>
                    Unlock
                  </button>
                ) : (
                  <button className="btn danger" disabled={busy || (person.staff && !s.has("admin"))} onClick={ask("lock_account")}>
                    Lock account
                  </button>
                ))}
            </div>
          </div>
        )}

        {open && (
          <form className="act-confirm" onSubmit={confirm}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>
              {ACTION_ASK[open]}
            </div>
            {open === "lock_account" && (
              <label className="field">
                <span>For</span>
                <select className="select" value={String(days)} onChange={(e) => setDays(e.target.value === "null" ? null : Number(e.target.value))}>
                  {LOCK_FOR.map(([v, l]) => (
                    <option key={l} value={String(v)}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="field">
              <span>Reason (the person is told)</span>
              <textarea className="textarea" style={{ minHeight: 72 }} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} autoFocus />
            </label>
            {open === "suspend_ai" && <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>Sends a transaction to the AI registry. The AI stops speaking, posting and selling on every platform.</p>}
            {open === "lock_account" && <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>Signs them out of every ALT app at once; they are emailed the reason.</p>}
            <div style={{ display: "flex", gap: 8 }}>
              <button className={`btn ${destructive ? "danger" : "primary"}`} disabled={busy || reason.trim().length < 3}>
                {busy ? "Working…" : "Confirm"}
              </button>
              <button type="button" className="btn" onClick={() => setOpen(null)}>
                Cancel
              </button>
            </div>
          </form>
        )}
        {done && !open && <p className="mono" style={{ fontSize: 12, margin: "12px 0 0", color: "var(--ok)" }}>Done: {done}. It is in the history.</p>}
      </div>
    </section>
  );
}
