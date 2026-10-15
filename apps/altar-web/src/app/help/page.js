"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button, Card, Chip, Spinner } from "../../components/ui";
import { useAuth } from "../../contexts/AuthContext";
import { altar, continueWithAlt, support } from "../../lib/alt";
import { polText, timeAgo } from "../../lib/format";

// What people can ask about. Disputes about a purchase and appeals against a moderation decision
// are their own kinds of case, so the right staff see them.
const TOPICS = [
  { key: "account", label: "My account", kind: "support", category: "account" },
  { key: "billing", label: "Payments & wallet", kind: "support", category: "billing" },
  { key: "dispute", label: "A purchase, rental or subscription", kind: "dispute", category: "marketplace" },
  { key: "appeal", label: "A moderation decision", kind: "appeal", category: "moderation" },
  { key: "other", label: "Something else", kind: "support", category: "other" },
];
const STATUS = { open: "Received", in_progress: "Being looked at", waiting: "Waiting for you", resolved: "Resolved", dismissed: "Closed" };
const KIND = { support: "Request", report: "Report", dispute: "Dispute", appeal: "Appeal", flag: "Flag" };
const caseNo = (n) => `#${String(n).padStart(4, "0")}`;

// Help & support: questions to ALT staff and the reports a person made, answered in the ALT
// Command Centre. The same cases show in every ALT app.
export default function HelpPage() {
  const { user } = useAuth();
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(null);
  const [asking, setAsking] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await support.mine();
      setItems(r.items);
      setError(null);
    } catch (err) {
      setError(err.message);
      setItems((cur) => cur ?? []);
    }
  }, []);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  if (!user)
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-sm flex-col items-center justify-center px-4 text-center">
        <p className="font-display text-2xl font-bold">Help &amp; support</p>
        <p className="mt-2 text-ink-2">Sign in to ask ALT for help or follow up on a report.</p>
        <Button className="mt-6" onClick={() => continueWithAlt("signin", "/help").catch(() => {})}>
          Continue with ALT
        </Button>
      </div>
    );

  return (
    <div className="mx-auto max-w-3xl px-4 pb-24 pt-8 sm:px-6 sm:pt-12">
      <Link href="/settings" className="text-sm font-semibold text-ink-3 hover:text-ink">
        ← Settings
      </Link>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-extrabold tracking-tight">Help &amp; support</h1>
          <p className="mt-2 max-w-xl text-ink-2">Ask ALT about your account, payments or an AI. Replies come from the ALT team, here and in your ALT inbox.</p>
        </div>
        {!asking && <Button onClick={() => setAsking(true)}>Ask for help</Button>}
      </div>

      {asking && (
        <NewRequest
          onClose={() => setAsking(false)}
          onSent={async (c) => {
            setAsking(false);
            await load();
            setOpen(c.id);
          }}
        />
      )}

      <Card className="mt-6 p-2 sm:p-3">
        <h2 className="px-3 pt-3 font-display text-lg font-bold">Your requests and reports</h2>
        {error && <p className="mx-3 mt-3 rounded-2xl bg-rose-500/10 px-4 py-2 text-sm text-rose-600">{error}</p>}
        {!items ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : items.length === 0 ? (
          <p className="px-3 py-6 text-ink-2">Nothing yet. If something goes wrong, ask for help, or report an AI or a review from its page.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {items.map((c) => (
              <li key={c.id}>
                <button onClick={() => setOpen(open === c.id ? null : c.id)} className="flex w-full items-center gap-3 rounded-2xl px-3 py-4 text-left transition hover:bg-sunken/60" aria-expanded={open === c.id}>
                  <span className="w-14 shrink-0 font-mono text-sm text-ink-3">{caseNo(c.number)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{c.title}</span>
                    <span className="text-sm text-ink-3">
                      {KIND[c.kind]} · updated {timeAgo(c.updatedAt)}
                    </span>
                  </span>
                  <Chip tone={c.status === "waiting" ? "warn" : c.status === "resolved" ? "accent" : "plain"}>{STATUS[c.status] ?? c.status}</Chip>
                </button>
                {open === c.id && <Thread id={c.id} onChange={load} />}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

const ROLE = { bought: "You bought", rented: "You rented", subscribed: "You subscribed to", sold: "You sold", rented_out: "You rented out", subscribed_out: "Subscription to", royalty: "Royalty from" };

function NewRequest({ onClose, onSent }) {
  const [topic, setTopic] = useState(TOPICS[0]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // An appeal names the decision; a dispute names the payment.
  const [decisions, setDecisions] = useState(null);
  const [payments, setPayments] = useState(null);
  const [decision, setDecision] = useState(null);
  const [payment, setPayment] = useState(null);

  useEffect(() => {
    if (topic.kind === "appeal" && !decisions) support.decisions().then((r) => setDecisions(r.items)).catch(() => setDecisions([]));
    if (topic.kind === "dispute" && !payments) altar.myActivity().then(setPayments).catch(() => setPayments([]));
  }, [topic, decisions, payments]);

  async function send(e) {
    e.preventDefault();
    if (title.trim().length < 3 || !body.trim()) return setError("Give it a short title and tell us what happened.");
    setBusy(true);
    setError(null);
    try {
      const r = await support.open({
        kind: topic.kind,
        category: topic.category,
        title: title.trim(),
        body: body.trim(),
        ...(topic.kind === "appeal" && decision ? { appealOf: decision.caseNumber } : {}),
        ...(topic.kind === "dispute" && payment ? { subject: { type: "transaction", id: payment.txHash } } : {}),
      });
      await onSent(r.case);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="animate-page-in mt-6 p-6">
      <form onSubmit={send}>
        <h2 className="font-display text-lg font-bold">What do you need help with?</h2>
        <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Topic">
          {TOPICS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="radio"
              aria-checked={topic.key === t.key}
              onClick={() => setTopic(t)}
              className={`rounded-full border px-3 py-1.5 text-sm transition ${topic.key === t.key ? "border-ink bg-ink text-canvas" : "border-line bg-surface text-ink-2 hover:border-ink/30"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {topic.kind === "appeal" && (
          <Picker
            label="Which decision?"
            empty="ALT staff haven't decided anything about you. You can still tell us what happened."
            items={decisions}
            selected={decision}
            onPick={(d) => {
              setDecision(d);
              setTitle(`Appeal of #${String(d.caseNumber).padStart(4, "0")}: ${d.label}`);
            }}
            render={(d) => (
              <>
                <span className="font-semibold">{d.label}</span> · {timeAgo(d.at)}
                <span className="block text-ink-3">{d.reason}</span>
              </>
            )}
            disabled={(d) => d.appealed && "Already appealed"}
            keyOf={(d) => `${d.caseNumber}-${d.action}-${d.at}`}
          />
        )}
        {topic.kind === "dispute" && (
          <Picker
            label="Which payment?"
            empty="No marketplace payments on your account yet."
            items={payments}
            selected={payment}
            onPick={(p) => {
              setPayment(p);
              setTitle(`About ${p.ai?.name ?? "an AI"}: ${p.kind} on ${new Date(p.occurredAt).toLocaleDateString()}`);
            }}
            render={(p) => (
              <>
                <span className="font-semibold">
                  {ROLE[p.role] ?? p.role} {p.ai?.name ?? "an AI"}
                </span>{" "}
                · {polText(p.amount)} · {timeAgo(p.occurredAt)}
              </>
            )}
            disabled={() => false}
            keyOf={(p) => p.id}
          />
        )}
        <label className="mt-4 block text-sm font-semibold text-ink-2">
          Title
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={140}
            placeholder="e.g. My rental was charged twice"
            className="mt-1.5 w-full rounded-2xl border border-line bg-surface px-4 py-3 text-[15px] font-normal text-ink outline-none focus:border-ink/30"
          />
        </label>
        <label className="mt-4 block text-sm font-semibold text-ink-2">
          What happened
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={5000}
            rows={5}
            placeholder="Which AI, when, and what you expected. Never share your password."
            className="mt-1.5 w-full rounded-2xl border border-line bg-surface px-4 py-3 text-[15px] font-normal text-ink outline-none focus:border-ink/30"
          />
        </label>
        {error && <p className="mt-3 rounded-2xl bg-rose-500/10 px-4 py-2 text-sm text-rose-600">{error}</p>}
        <div className="mt-4 flex gap-2">
          <Button type="submit" disabled={busy}>
            {busy ? "Sending…" : "Send to ALT"}
          </Button>
          <Button type="button" kind="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** One case: what the person wrote and ALT's replies; they can answer while it is open. */
function Thread({ id, onChange }) {
  const [data, setData] = useState(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await support.get(id));
    } catch (err) {
      setError(err.message);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function reply(e) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await support.reply(id, text.trim());
      setText("");
      await load();
      onChange?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!data)
    return (
      <div className="flex justify-center py-6">
        <Spinner />
      </div>
    );
  const closed = data.case.status === "resolved" || data.case.status === "dismissed";
  const lines = data.events.filter((e) => e.body || e.kind === "status");
  return (
    <div className="animate-page-in px-3 pb-5">
      <ol className="space-y-3">
        {lines.map((e) =>
          e.kind === "status" && !e.body ? null : (
            <li key={e.id} className={`flex ${e.from === "you" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${e.from === "you" ? "bg-ink text-canvas" : "bg-sunken/80 text-ink"}`}>
                <p className={`text-xs font-semibold ${e.from === "you" ? "text-canvas/70" : "text-ink-3"}`}>
                  {e.from === "you" ? "You" : "ALT team"} · {timeAgo(e.at)}
                </p>
                <p className="mt-1 whitespace-pre-line text-[15px]">{e.body}</p>
              </div>
            </li>
          ),
        )}
      </ol>
      {closed ? (
        <p className="mt-4 text-sm text-ink-3">This is closed. If you still need help, ask again with a new request.</p>
      ) : (
        <form onSubmit={reply} className="mt-4 flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={5000}
            placeholder={data.case.status === "waiting" ? "ALT is waiting for your answer…" : "Add something…"}
            aria-label="Your message"
            className="min-w-0 flex-1 rounded-full border border-line bg-surface px-4 py-2.5 text-[15px] text-ink outline-none focus:border-ink/30"
          />
          <Button type="submit" size="sm" disabled={busy || !text.trim()}>
            Send
          </Button>
        </form>
      )}
      {error && <p className="mt-2 rounded-2xl bg-rose-500/10 px-4 py-2 text-sm text-rose-600">{error}</p>}
    </div>
  );
}

/** Picks the decision an appeal is about, or the payment a dispute is about. */
function Picker({ label, empty, items, selected, onPick, render, disabled, keyOf }) {
  return (
    <fieldset className="mt-4">
      <legend className="text-sm font-semibold text-ink-2">{label}</legend>
      {!items ? (
        <div className="py-4">
          <Spinner />
        </div>
      ) : items.length === 0 ? (
        <p className="mt-2 text-sm text-ink-3">{empty}</p>
      ) : (
        <ul className="mt-2 max-h-64 space-y-2 overflow-y-auto">
          {items.map((it) => {
            const why = disabled(it);
            const on = selected && keyOf(selected) === keyOf(it);
            return (
              <li key={keyOf(it)}>
                <button
                  type="button"
                  disabled={Boolean(why)}
                  onClick={() => onPick(it)}
                  aria-pressed={on}
                  className={`w-full rounded-2xl border px-4 py-3 text-left text-sm transition disabled:opacity-50 ${on ? "border-ink bg-sunken" : "border-line bg-surface hover:border-ink/30"}`}
                >
                  {render(it)}
                  {why && <span className="mt-1 block text-xs font-semibold text-ink-3">{why}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </fieldset>
  );
}
