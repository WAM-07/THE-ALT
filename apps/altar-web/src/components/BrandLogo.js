"use client";
import { useSyncExternalStore } from "react";

// The logos of The ALT Ecosystem (docs/brand/logo-pack), inline so they follow every theme: the A
// and ALT's hexagon take the text colour (currentColor); the platform's colour stays; on dark themes
// the inner mark turns paper (--logo-mark, set in globals.css). `animated` plays the pack's
// 5-second loop (CSS in globals.css under .brand-anim), which stops for reduced motion.

const A = <path className="drawa len-a" d="M32 71 L50 31 L68 71" fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />;

const SHAPES = {
  alt: (animated) => (
    <>
      <path className="draw len-hex" d="M50 7 L87 28.5 L87 71.5 L50 93 L13 71.5 L13 28.5 Z" fill="none" stroke="currentColor" strokeWidth="7" strokeLinejoin="round" />
      {A}
      {animated && <circle className="ping" cx="50" cy="62" r="5.5" fill="none" stroke="var(--logo-dot, #2152D9)" strokeWidth="1.5" />}
      <circle className="pop" cx="50" cy="62" r="5.5" fill="var(--logo-dot, #2152D9)" />
    </>
  ),
  alter: () => (
    <>
      <rect className="draw len-sq" x="11" y="11" width="78" height="78" rx="24" fill="none" stroke="#2152D9" strokeWidth="7" />
      {A}
      <path className="twinkle" d="M50 54.5 Q51.1 59.9 56.5 61 Q51.1 62.1 50 67.5 Q48.9 62.1 43.5 61 Q48.9 59.9 50 54.5 Z" fill="var(--logo-mark, #2152D9)" />
    </>
  ),
  altar: () => (
    <g className="flip">
      <circle className="draw len-coin" cx="50" cy="50" r="42" fill="none" stroke="#128A50" strokeWidth="7" />
      <circle className="drawa len-ring" cx="50" cy="50" r="35" fill="none" stroke="#128A50" strokeWidth="2" />
      {A}
      <path className="pop" d="M50 55 L56 62 L50 69 L44 62 Z" fill="var(--logo-mark, #128A50)" stroke="var(--logo-mark, #128A50)" strokeWidth="1.5" strokeLinejoin="round" />
    </g>
  ),
  altera: () => (
    <>
      <g className="wave">
        <path className="draw len-in" d="M20.56 34 A34 34 0 0 0 20.56 68" fill="none" stroke="#E8601A" strokeWidth="7" strokeLinecap="round" />
        <path className="draw len-in" d="M79.44 34 A34 34 0 0 1 79.44 68" fill="none" stroke="#E8601A" strokeWidth="7" strokeLinecap="round" />
      </g>
      <g className="wave late">
        <path className="drawb len-out" d="M13.96 25.75 A44 44 0 0 0 13.96 76.25" fill="none" stroke="#E8601A" strokeWidth="5.5" strokeLinecap="round" />
        <path className="drawb len-out" d="M86.04 25.75 A44 44 0 0 1 86.04 76.25" fill="none" stroke="#E8601A" strokeWidth="5.5" strokeLinecap="round" />
      </g>
      {A}
      <circle className="type" cx="44.5" cy="64" r="2.6" fill="var(--logo-mark, #E8601A)" />
      <circle className="type d2" cx="50" cy="64" r="2.6" fill="var(--logo-mark, #E8601A)" />
      <circle className="type d3" cx="55.5" cy="64" r="2.6" fill="var(--logo-mark, #E8601A)" />
    </>
  ),
};

const NAMES = { alt: "ALT", alter: "ALTER", altar: "ALTAR", altera: "ALTERA" };

export function BrandLogo({ kind = "altar", animated = false, className = "h-8 w-8", title }) {
  const label = title ?? NAMES[kind];
  return (
    <svg viewBox="0 0 100 100" className={`${animated ? "brand-anim " : ""}${className}`} role={label ? "img" : undefined} aria-label={label || undefined} aria-hidden={label ? undefined : true}>
      {SHAPES[kind](animated)}
    </svg>
  );
}

// ---------------------------------------------------------------- the classic ALT mark

// ALT's first mark, three bars (ALTAR green, ALTERA orange, ink); kept on purpose
// (docs/brand/classic). Settings → Advanced → Appearance lab switches "Continue with ALT" back to it.
export const CLASSIC_MARK_KEY = "altar_alt_mark";
const CHANGED = "altar-alt-mark";

function readClassic() {
  try {
    return localStorage.getItem(CLASSIC_MARK_KEY) === "classic";
  } catch {
    return false;
  }
}

export function setClassicMark(on) {
  try {
    if (on) localStorage.setItem(CLASSIC_MARK_KEY, "classic");
    else localStorage.removeItem(CLASSIC_MARK_KEY);
  } catch {
    // Storage can be blocked (private windows); nothing to remember then.
  }
  window.dispatchEvent(new Event(CHANGED));
}

export function useClassicMark() {
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener(CHANGED, onChange);
      window.addEventListener("storage", onChange);
      return () => {
        window.removeEventListener(CHANGED, onChange);
        window.removeEventListener("storage", onChange);
      };
    },
    readClassic,
    () => false,
  );
}

/** ALT's mark beside "Continue with ALT": the hexagon logo, or the classic bars when switched on. */
export function AltMark({ className = "h-5 w-5" }) {
  const classic = useClassicMark();
  if (classic) {
    return (
      <span className="inline-grid grid-cols-3 gap-[3px]" aria-hidden="true">
        <i className="block h-4 w-[5px] rounded-sm bg-[#1f9a5c]" />
        <i className="block h-4 w-[5px] rounded-sm bg-[#f0802a]" />
        <i className="block h-4 w-[5px] rounded-sm bg-current" />
      </span>
    );
  }
  return <BrandLogo kind="alt" className={className} title="" />;
}

/** A page that is still loading: ALTAR's animated logo instead of a spinner. */
export function PageLoader({ kind = "altar", className = "min-h-[60vh]" }) {
  return (
    <div className={`flex items-center justify-center ${className}`} role="status" aria-label="Loading">
      <BrandLogo kind={kind} animated className="h-20 w-20 text-ink" title="" />
    </div>
  );
}
