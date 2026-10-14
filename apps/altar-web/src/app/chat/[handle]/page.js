"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import AitArt from "../../../components/AitArt";
import { Avatar, Button, Spinner, VerifiedTick } from "../../../components/ui";
import { useAuth } from "../../../contexts/AuthContext";
import { toModel, useAI } from "../../../contexts/AIContext";
import { altar, api, continueWithAlt, conversations, publicApi } from "../../../lib/alt";

/** "2 days 3 h", "45 min": how long a rental or subscription still runs. */
function timeLeft(until, now) {
  const ms = new Date(until).getTime() - now;
  if (ms <= 0) return null;
  const min = Math.ceil(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h ${min % 60} min`;
  return `${Math.floor(h / 24)} days ${h % 24} h`;
}

/** Shows **bold** in an AI's reply as bold text (and nothing else: replies are never treated as HTML). */
const withBold = (text) => text.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : part));

/** Adds messages to a list without repeating any (by id), oldest first. */
const merge = (list, more) => {
  const seen = new Set(list.map((m) => String(m.id)));
  return [...list, ...more.filter((m) => !seen.has(String(m.id)))];
};

/**
 * The AIs this person can talk to on ALTAR: the ones they own, rent or subscribe to, with how long
 * each lasts. Shown as picture bubbles to switch between conversations.
 */
function useMyAis(user) {
  const { aiModels } = useAI();
  const [owned, setOwned] = useState(null);
  const [using, setUsing] = useState(null);
  useEffect(() => {
    if (!user) return;
    api("/core/ais")
      .then((list) => setOwned(list.filter((a) => a.verified).map(toModel)))
      .catch(() => setOwned([]));
    altar
      .myRentals()
      .then(setUsing)
      .catch(() => setUsing([]));
  }, [user]);
  return useMemo(() => {
    if (!owned || !using) return null;
    const picture = (id) => aiModels?.find((m) => m.id === id)?.image ?? null;
    const items = owned.map((a) => ({ id: a.id, handle: a.handle, name: a.name, image: a.image, role: "Owned", until: null }));
    for (const u of using) {
      if (!u.ai || items.some((i) => i.id === u.ai.id)) continue;
      items.push({ id: u.ai.id, handle: u.ai.handle, name: u.ai.name, image: picture(u.ai.id), role: u.kind === "subscription" ? "Subscribed" : "Rented", until: u.expiresAt });
    }
    return items;
  }, [owned, using, aiModels]);
}

// One chat per AI: switching AIs starts the page afresh, so nothing from the last one lingers.
export default function ChatPage() {
  const { handle } = useParams();
  return <Chat key={handle} handle={handle} />;
}

// Talking to an AI on ALTAR: its owner any time, a renter or subscriber until their time ends. Every
// reply comes from ALT Core's persona engine, using the AI's published version. Past conversations
// stay readable.
function Chat({ handle }) {
  const { user } = useAuth();
  const myAis = useMyAis(user);
  const [ai, setAi] = useState(null);
  const [state, setState] = useState(null); // { access, conversations }
  const [active, setActive] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const bottom = useRef(null);
  // A conversation this page just started: its messages arrive with the reply, so don't fetch them too.
  const justStarted = useRef(null);

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
    if (justStarted.current === active) {
      justStarted.current = null;
      return;
    }
    let live = true;
    conversations
      .messages(ai.id, active)
      .then((list) => live && setMessages(list))
      .catch((err) => live && setError(err.message));
    return () => {
      live = false;
    };
  }, [ai, active]);

  // The clock for "time left", and the moment it ends.
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
  const left = role === "renter" || role === "subscriber" ? timeLeft(until, now) : null;
  const canTalk = role === "owner" || Boolean(left);

  const send = async (e) => {
    e.preventDefault();
    const content = draft.trim();
    if (!content || busy) return;
    setBusy(true);
    setError(null);
    const pending = { id: `pending-${Date.now()}`, role: "user", content };
    try {
      let id = active;
      if (!id) {
        id = (await conversations.start(ai.id)).id;
        justStarted.current = id;
        setActive(id);
      }
      setMessages((m) => [...m, pending]);
      setDraft("");
      const r = await conversations.say(ai.id, id, content);
      setMessages((m) => merge(m.filter((x) => x.id !== pending.id), [r.message, r.reply]));
      if (!state.conversations.some((c) => c.id === id)) load();
    } catch (err) {
      setError(err.message);
      setMessages((m) => m.filter((x) => x.id !== pending.id));
      setDraft(content);
      if (err.code === "NO_ACCESS") load();
    } finally {
      setBusy(false);
    }
  };

  const newConversation = () => {
    setActive(null);
    setMessages([]);
  };

  return (
    <div className="mx-auto flex h-[calc(100vh-4rem)] max-w-[1320px] gap-4 px-4 py-4 sm:px-6 sm:py-5">
      {/* Your AIs and this AI's conversations */}
      <aside className="hidden w-72 shrink-0 flex-col gap-4 md:flex">
        <div className="flex min-h-0 flex-1 flex-col rounded-3xl border border-line bg-surface p-3">
          <p className="px-2 pb-2 pt-1 text-xs font-semibold uppercase tracking-wide text-ink-3">Your AIs</p>
          <div className="min-h-0 space-y-1 overflow-y-auto">
            {myAis === null && <Spinner className="m-3 h-6 w-6" />}
            {myAis?.length === 0 && (
              <p className="px-2 py-2 text-sm text-ink-3">
                Rent or subscribe to an AI to chat with it here.{" "}
                <Link href="/#explore" className="font-semibold text-ink underline underline-offset-4">
                  Explore
                </Link>
              </p>
            )}
            {myAis?.map((a) => {
              const on = a.handle === ai.handle;
              const rest = a.until ? timeLeft(a.until, now) : null;
              return (
                <Link key={a.id} href={`/chat/${a.handle}`} className={`flex items-center gap-3 rounded-2xl p-2 transition ${on ? "bg-sunken" : "hover:bg-sunken/60"}`} aria-current={on ? "page" : undefined}>
                  <span className={`flex shrink-0 rounded-full p-1 ${on ? "bg-accent" : ""}`}>
                    <Avatar src={a.image} name={a.name} size={40} className="ring-2 ring-surface" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{a.name}</span>
                    <span className="block truncate text-xs text-ink-3">{a.role === "Owned" ? "Yours" : rest ? `${a.role} · ${rest} left` : `${a.role} · ended`}</span>
                  </span>
                </Link>
              );
            })}
          </div>
        </div>

        <div className="flex max-h-[45%] min-h-0 flex-col rounded-3xl border border-line bg-surface p-3">
          <div className="flex items-center justify-between gap-2 px-2 pb-2 pt-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">Conversations</p>
            <button onClick={newConversation} disabled={!canTalk} className="text-sm font-semibold text-accent-text hover:underline disabled:opacity-40">
              + New
            </button>
          </div>
          <div className="min-h-0 space-y-1 overflow-y-auto">
            {state.conversations.map((c) => (
              <button key={c.id} onClick={() => setActive(c.id)} className={`block w-full truncate rounded-xl px-3 py-2 text-left text-sm ${c.id === active ? "bg-sunken font-semibold" : "text-ink-2 hover:bg-sunken/60"}`}>
                {c.title ?? "New conversation"}
              </button>
            ))}
            {state.conversations.length === 0 && <p className="px-2 py-2 text-sm text-ink-3">No conversations yet.</p>}
          </div>
        </div>
      </aside>

      {/* The conversation */}
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-3xl border border-line bg-surface">
        {/* Phones: the AIs as a strip of bubbles */}
        {myAis?.length > 1 && (
          <div className="no-scrollbar flex gap-3 overflow-x-auto border-b border-line px-4 py-3 md:hidden">
            {myAis.map((a) => (
              <Link key={a.id} href={`/chat/${a.handle}`} className="flex w-14 shrink-0 flex-col items-center gap-1">
                <span className={`flex rounded-full p-1 ${a.handle === ai.handle ? "bg-accent" : ""}`}>
                  <Avatar src={a.image} name={a.name} size={44} className="ring-2 ring-surface" />
                </span>
                <span className="w-full truncate text-center text-[11px] text-ink-2">{a.name}</span>
              </Link>
            ))}
          </div>
        )}

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
            <p className="text-sm text-ink-2">{role === "owner" ? "You own this AI" : left ? `${role === "subscriber" ? "Subscribed" : "Rented"} · ${left} left` : "Your time has ended"}</p>
          </div>
          <button onClick={newConversation} disabled={!canTalk} className="relative rounded-full border border-line bg-surface px-3 py-1.5 text-sm font-semibold disabled:opacity-40 md:hidden">
            + New
          </button>
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
              <p className={`max-w-[80%] whitespace-pre-line rounded-3xl px-4 py-2.5 text-[15px] leading-relaxed ${m.role === "user" ? "rounded-br-lg bg-pop text-pop-ink" : "rounded-bl-lg bg-sunken text-ink"}`}>{m.role === "user" ? m.content : withBold(m.content)}</p>
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
            <p className="text-sm text-ink-2">{state.conversations.length ? "Your rental or subscription has ended. Your conversations stay here to read." : `Rent or subscribe to ${ai.name} to talk to it.`}</p>
            <Button href={`/details/${ai.handle}`} size="sm">
              See options
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
