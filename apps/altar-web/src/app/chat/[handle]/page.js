"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import AitArt from "../../../components/AitArt";
import { Avatar, Button, Spinner, VerifiedTick } from "../../../components/ui";
import { useAuth } from "../../../contexts/AuthContext";
import { toModel } from "../../../contexts/AIContext";
import { continueWithAlt, conversations, publicApi } from "../../../lib/alt";

/** "2 days 3 h", "45 min": how long a rental still runs. */
function timeLeft(until, now) {
  const ms = new Date(until).getTime() - now;
  if (ms <= 0) return null;
  const min = Math.ceil(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h ${min % 60} min`;
  return `${Math.floor(h / 24)} days ${h % 24} h`;
}

// Talking to an AI on ALTAR: a renter until the rental ends, or the owner any time. Every reply comes
// from ALT Core's persona engine, using the AI's published version. Past conversations stay readable.
export default function ChatPage() {
  const { handle } = useParams();
  const { user } = useAuth();
  const [ai, setAi] = useState(null);
  const [state, setState] = useState(null); // { access, conversations }
  const [active, setActive] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const bottom = useRef(null);

  useEffect(() => {
    publicApi(`/core/public/ais/${encodeURIComponent(handle)}?platform=altar`)
      .then((a) => setAi(toModel(a)))
      .catch(() => setError("This AI isn't on ALTAR."));
  }, [handle]);

  const load = useCallback(async () => {
    if (!ai) return;
    try {
      const s = await conversations.list(ai.id);
      setState(s);
      setActive((cur) => cur ?? s.conversations[0]?.id ?? null);
    } catch (err) {
      setError(err.message);
    }
  }, [ai]);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  useEffect(() => {
    if (!ai || !active) return;
    conversations
      .messages(ai.id, active)
      .then(setMessages)
      .catch((err) => setError(err.message));
  }, [ai, active]);

  // The clock for "time left", and the moment the rental ends.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Braces matter: newer browsers return a Promise from scrollIntoView, and an effect may only return a cleanup.
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  if (!user) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-sm flex-col items-center justify-center px-4 text-center">
        <p className="font-display text-2xl font-bold">Sign in to chat</p>
        <Button className="mt-6" onClick={() => continueWithAlt("signin", `/chat/${handle}`).catch(() => {})}>
          Continue with ALT
        </Button>
      </div>
    );
  }
  if (error && !ai) return <p className="mx-auto max-w-md px-4 py-24 text-center text-ink-2">{error}</p>;
  if (!ai || !state) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const { role, until } = state.access;
  const left = role === "renter" ? timeLeft(until, now) : null;
  const canTalk = role === "owner" || Boolean(left);

  const send = async (e) => {
    e.preventDefault();
    const content = draft.trim();
    if (!content || busy) return;
    setBusy(true);
    setError(null);
    try {
      let id = active;
      if (!id) {
        id = (await conversations.start(ai.id)).id;
        setActive(id);
      }
      setMessages((m) => [...m, { id: `pending-${Date.now()}`, role: "user", content }]);
      setDraft("");
      const r = await conversations.say(ai.id, id, content);
      setMessages((m) => [...m.filter((x) => !String(x.id).startsWith("pending-")), r.message, r.reply]);
      if (!state.conversations.some((c) => c.id === id)) load();
    } catch (err) {
      setError(err.message);
      setMessages((m) => m.filter((x) => !String(x.id).startsWith("pending-")));
      setDraft(content);
      if (err.code === "NO_ACCESS") load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex h-[calc(100vh-4rem)] max-w-[1100px] gap-5 px-4 py-5 sm:px-6">
      {/* Conversations */}
      <aside className="hidden w-64 shrink-0 flex-col rounded-3xl border border-line bg-surface p-3 md:flex">
        <Button
          kind="outline"
          size="sm"
          disabled={!canTalk}
          onClick={() => {
            setActive(null);
            setMessages([]);
          }}
        >
          New conversation
        </Button>
        <div className="mt-3 space-y-1 overflow-y-auto">
          {state.conversations.map((c) => (
            <button key={c.id} onClick={() => setActive(c.id)} className={`block w-full truncate rounded-xl px-3 py-2 text-left text-sm ${c.id === active ? "bg-sunken font-semibold" : "text-ink-2 hover:bg-sunken/60"}`}>
              {c.title ?? "New conversation"}
            </button>
          ))}
          {state.conversations.length === 0 && <p className="px-3 py-2 text-sm text-ink-3">No conversations yet.</p>}
        </div>
      </aside>

      {/* The conversation */}
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-3xl border border-line bg-surface">
        <header className="relative flex items-center gap-3 overflow-hidden border-b border-line p-4">
          <AitArt seed={ai.artSeed} className="absolute inset-0 opacity-20" grain={false} />
          <Avatar src={ai.image} name={ai.name} size={44} className="relative" />
          <div className="relative min-w-0 flex-1">
            <p className="flex items-center gap-1.5 truncate font-display text-lg font-bold">
              <Link href={`/details/${ai.handle}`} className="truncate hover:underline">
                {ai.name}
              </Link>
              <VerifiedTick />
            </p>
            <p className="text-sm text-ink-2">{role === "owner" ? "You own this AI" : left ? `Rented · ${left} left` : "Rental ended"}</p>
          </div>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto p-4 sm:p-6">
          {messages.length === 0 && (
            <div className="mx-auto max-w-sm py-16 text-center">
              <Avatar src={ai.image} name={ai.name} size={72} className="mx-auto" />
              <p className="mt-4 font-display text-xl font-bold">Say hello to {ai.name}</p>
              <p className="mt-1 text-sm text-ink-3">{ai.description}</p>
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} className={`animate-page-in flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <p className={`max-w-[80%] whitespace-pre-line rounded-3xl px-4 py-2.5 text-[15px] leading-relaxed ${m.role === "user" ? "rounded-br-lg bg-pop text-pop-ink" : "rounded-bl-lg bg-sunken text-ink"}`}>{m.content}</p>
            </div>
          ))}
          {busy && (
            <div className="flex justify-start">
              <p className="rounded-3xl rounded-bl-lg bg-sunken px-4 py-3">
                <span className="inline-flex gap-1" aria-label={`${ai.name} is typing`}>
                  {[0, 1, 2].map((i) => (
                    <span key={i} className="h-2 w-2 animate-bounce rounded-full bg-ink-3" style={{ animationDelay: `${i * 120}ms` }} />
                  ))}
                </span>
              </p>
            </div>
          )}
          <div ref={bottom} />
        </div>

        {error && <p className="mx-4 mb-2 rounded-2xl bg-rose-500/10 px-4 py-2 text-sm text-rose-600">{error}</p>}
        {canTalk ? (
          <form onSubmit={send} className="flex gap-2 border-t border-line p-3">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={4000}
              placeholder={`Message ${ai.name}`}
              aria-label="Message"
              className="h-12 min-w-0 flex-1 rounded-full border border-line bg-sunken/60 px-5 text-[15px] outline-none focus:border-ink/30"
            />
            <Button type="submit" size="lg" disabled={busy || !draft.trim()}>
              Send
            </Button>
          </form>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line p-4">
            <p className="text-sm text-ink-2">{role === "renter" || until ? "Your rental has ended. Your conversations stay here to read." : `Rent ${ai.name} to talk to it.`}</p>
            <Button href={`/details/${ai.handle}`} size="sm">
              Rent again
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
