"use client";
import { useEffect, useRef, useState } from "react";
import { mediaUrl, pictures as altPictures } from "../lib/alt";
import { Avatar, Button, Spinner } from "./ui";

const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = ["image/png", "image/jpeg", "image/webp"];

/**
 * Chooses a profile picture: one of ALT's ready-made sets or an upload. People ("human") and AIs
 * ("ai") see different sets. For people, `scope` decides where it shows: everywhere (the ALT
 * account) or on ALTAR only.
 *
 * onSave({ url } | { file }, scope) does the saving; onUseGlobal (people, ALTAR-only picture set)
 * removes the ALTAR-only picture.
 */
export default function PicturePicker({ kind, title, current, name, onSave, onUseGlobal, onClose }) {
  const [sets, setSets] = useState(null);
  const [setId, setSetId] = useState(null);
  const [picked, setPicked] = useState(null); // { url } or { file, preview }
  const [scope, setScope] = useState("everywhere");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const fileInput = useRef(null);

  useEffect(() => {
    let live = true;
    altPictures
      .presets(kind)
      .then((s) => {
        if (!live) return;
        setSets(s);
        setSetId(s[0]?.id ?? null);
      })
      .catch(() => live && setError("Couldn't load the pictures. Try again in a moment."));
    return () => {
      live = false;
    };
  }, [kind]);

  useEffect(() => {
    const esc = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);

  // Free the preview of an uploaded file when it's replaced or the picker closes.
  useEffect(() => () => picked?.preview && URL.revokeObjectURL(picked.preview), [picked]);

  const chooseFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!TYPES.includes(file.type)) return setError("Use a PNG, JPEG or WebP image.");
    if (file.size > MAX_BYTES) return setError("The image must be 5 MB or smaller.");
    setError(null);
    setPicked({ file, preview: URL.createObjectURL(file) });
  };

  const save = async () => {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(picked.file ? { file: picked.file } : { url: picked.url }, scope);
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const set = sets?.find((s) => s.id === setId);
  const preview = picked?.preview ?? mediaUrl(picked?.url) ?? current;

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-labelledby="picker-title" className="animate-page-in relative flex max-h-[92vh] w-full max-w-xl flex-col rounded-t-[28px] border border-line bg-surface shadow-card sm:rounded-[28px]">
        <div className="flex items-center gap-4 border-b border-line p-5 sm:p-6">
          <Avatar src={preview} name={name} size={64} className="ring-4 ring-sunken" />
          <div className="min-w-0 flex-1">
            <h2 id="picker-title" className="font-display text-xl font-bold">
              {title}
            </h2>
            <p className="text-sm text-ink-3">{kind === "ai" ? "Robots, androids and AI cores, or upload your own." : "Pick a character or upload your own photo."}</p>
          </div>
          <button onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-2 hover:bg-sunken" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="overflow-y-auto p-5 sm:p-6">
          {kind === "human" && (
            <div className="mb-5">
              <div className="grid grid-cols-2 gap-1 rounded-2xl bg-sunken p-1" role="radiogroup" aria-label="Where to use it">
                {[
                  ["everywhere", "Everywhere"],
                  ["altar", "Only on ALTAR"],
                ].map(([id, label]) => (
                  <button
                    key={id}
                    role="radio"
                    aria-checked={scope === id}
                    onClick={() => setScope(id)}
                    className={`h-9 rounded-xl text-sm font-semibold transition ${scope === id ? "bg-surface text-ink shadow-sm" : "text-ink-2 hover:text-ink"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-ink-3">
                {scope === "everywhere" ? "Your ALT picture: shown in ALTER, ALTERA and ALTAR." : "Shown on ALTAR only. ALTER and ALTERA keep your ALT picture."}
              </p>
            </div>
          )}

          {!sets && !error && (
            <div className="flex justify-center py-10">
              <Spinner />
            </div>
          )}
          {sets && (
            <>
              <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 sm:-mx-6 sm:px-6">
                {sets.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setSetId(s.id)}
                    className={`h-9 shrink-0 rounded-full px-4 text-sm font-semibold transition ${s.id === setId ? "bg-pop text-pop-ink" : "border border-line text-ink-2 hover:border-ink/30"}`}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
              <div className="mt-4 grid grid-cols-4 gap-2 sm:gap-3">
                {set?.pictures.map((url) => {
                  const on = picked?.url === url;
                  return (
                    <button
                      key={url}
                      onClick={() => setPicked({ url })}
                      aria-pressed={on}
                      aria-label={`${set.name} picture`}
                      className={`aspect-square overflow-hidden rounded-2xl transition hover:scale-[1.04] ${on ? "ring-4 ring-accent" : "ring-1 ring-line"}`}
                    >
                      <img src={mediaUrl(url)} alt="" className="h-full w-full object-cover" loading="lazy" />
                    </button>
                  );
                })}
              </div>
              {set && <p className="mt-3 text-xs text-ink-3">{set.credit}</p>}
            </>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-3 rounded-2xl border border-dashed border-line p-4">
            <div className="min-w-0 flex-1">
              <p className="font-semibold">Upload your own</p>
              <p className="text-xs text-ink-3">PNG, JPEG or WebP, up to 5 MB.</p>
            </div>
            <Button kind="outline" size="sm" onClick={() => fileInput.current?.click()}>
              Choose a file
            </Button>
            <input ref={fileInput} type="file" accept={TYPES.join(",")} className="hidden" onChange={chooseFile} />
          </div>

          {error && <p className="mt-4 rounded-2xl bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-600">{error}</p>}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-line p-5 sm:p-6">
          {onUseGlobal && (
            <button
              onClick={async () => {
                setBusy(true);
                try {
                  await onUseGlobal();
                  onClose();
                } catch (err) {
                  setError(err.message);
                  setBusy(false);
                }
              }}
              className="mr-auto text-sm font-semibold text-ink-2 underline underline-offset-4 hover:text-ink"
            >
              Use my ALT picture on ALTAR
            </button>
          )}
          <Button kind="ghost" onClick={onClose} className="ml-auto">
            Cancel
          </Button>
          <Button onClick={save} disabled={!picked || busy}>
            {busy ? "Saving…" : "Save picture"}
          </Button>
        </div>
      </div>
    </div>
  );
}
