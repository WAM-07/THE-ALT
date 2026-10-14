"use client";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { altar, mediaUrl } from "../lib/alt";
import { timeAgo } from "../lib/format";
import { Avatar, Button, Card } from "./ui";

const BASIS = { bought: "Bought it", rented: "Rented it", subscribed: "Subscribed" };

export function Stars({ value, size = "text-base" }) {
  const full = Math.round(value);
  return (
    <span className={`${size} tracking-tight`} aria-label={`${value} out of 5`}>
      <span className="text-amber-500">{"★".repeat(full)}</span>
      <span className="text-ink-3/40">{"★".repeat(5 - full)}</span>
    </span>
  );
}

/**
 * An AI's reviews. Only people the chain shows as buyers, renters or subscribers may write one
 * (ALTAR checks); owners and creators can't review their own AI. Text is moderated by ALT.
 */
export default function Reviews({ ai, onChange }) {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [mine, setMine] = useState(null);
  const [rating, setRating] = useState(0);
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setData(await altar.reviews(ai.id).catch(() => ({ average: null, count: 0, reviews: [] })));
    if (user) {
      const m = await altar.myReview(ai.id).catch(() => null);
      setMine(m);
      setRating(m?.review?.rating ?? 0);
      setText(m?.review?.body ?? "");
    }
  }, [ai.id, user]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (e) => {
    e.preventDefault();
    if (!rating) return setError("Choose a rating from 1 to 5 stars.");
    setBusy(true);
    setError(null);
    try {
      await altar.saveReview(ai.id, rating, text.trim() || null);
      setEditing(false);
      await load();
      onChange?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await altar.deleteReview(ai.id);
      setEditing(false);
      await load();
      onChange?.();
    } finally {
      setBusy(false);
    }
  };

  if (!data) return null;
  const showForm = mine?.canReview && (editing || !mine.review);

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-display text-lg font-bold">Reviews</h2>
        {data.count > 0 && (
          <p className="flex items-center gap-2 text-sm text-ink-2">
            <Stars value={data.average} /> <b className="text-ink">{data.average.toFixed(1)}</b> from {data.count} {data.count === 1 ? "review" : "reviews"}
          </p>
        )}
      </div>

      {showForm && (
        <form onSubmit={save} className="animate-page-in mt-4 rounded-2xl bg-sunken/60 p-4">
          <p className="text-sm font-semibold">{mine.review ? "Edit your review" : `You ${mine.basis === "bought" ? "own" : mine.basis === "rented" ? "rented" : "subscribed to"} ${ai.name}. How was it?`}</p>
          <div className="mt-2 flex gap-1" role="radiogroup" aria-label="Rating">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} star${n === 1 ? "" : "s"}`} onClick={() => setRating(n)} className={`text-3xl transition hover:scale-110 ${n <= rating ? "text-amber-500" : "text-ink-3/40"}`}>
                ★
              </button>
            ))}
          </div>
          <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} rows={3} placeholder="What was it good at? (optional)" className="mt-3 w-full rounded-2xl border border-line bg-surface px-4 py-3 text-[15px] text-ink outline-none focus:border-ink/30" />
          {error && <p className="mt-2 rounded-2xl bg-rose-500/10 px-4 py-2 text-sm text-rose-600">{error}</p>}
          <div className="mt-3 flex gap-2">
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? "Saving…" : "Post review"}
            </Button>
            {mine.review && (
              <Button type="button" kind="ghost" size="sm" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      )}

      {data.count === 0 && !showForm && <p className="mt-2 text-ink-2">No reviews yet. People who buy, rent or subscribe to {ai.name} can review it.</p>}

      <ul className="mt-2 divide-y divide-line">
        {data.reviews.map((r) => {
          const isMine = user && r.reviewer.id === user.id;
          return (
            <li key={r.reviewer.id} className="flex gap-3 py-4">
              <Avatar src={mediaUrl(r.reviewer.avatarUrl)} name={r.reviewer.name} size={40} />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-2 text-sm">
                  <b>{r.reviewer.name}</b>
                  <span className="text-ink-3">· {BASIS[r.basis]} · {timeAgo(r.updatedAt)}</span>
                </p>
                <Stars value={r.rating} size="text-sm" />
                {r.body && <p className="mt-1 whitespace-pre-line text-ink-2">{r.body}</p>}
                {isMine && !editing && (
                  <p className="mt-2 flex gap-3 text-sm">
                    <button onClick={() => setEditing(true)} className="font-semibold text-ink-2 underline underline-offset-4 hover:text-ink">
                      Edit
                    </button>
                    <button onClick={remove} disabled={busy} className="font-semibold text-ink-3 underline underline-offset-4 hover:text-ink">
                      Remove
                    </button>
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
