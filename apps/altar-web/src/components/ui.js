"use client";
import Link from "next/link";
import { initials } from "../lib/format";

// ALTAR's building blocks. Screens take their colours from the theme tokens (see globals.css)
// and their pieces from here, so every page looks like the same product.

export const btn = {
  base: "inline-flex items-center justify-center gap-2 rounded-full font-semibold transition active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none",
  size: { sm: "h-9 px-4 text-sm", md: "h-11 px-5 text-[15px]", lg: "h-13 px-7 text-base" },
  kind: {
    pop: "bg-pop text-pop-ink hover:opacity-90",
    accent: "bg-accent text-accent-ink hover:brightness-105",
    outline: "border border-line bg-surface text-ink hover:border-ink/40",
    ghost: "text-ink hover:bg-ink/5",
  },
};
export const btnClass = (kind = "pop", size = "md", extra = "") => `${btn.base} ${btn.size[size]} ${btn.kind[kind]} ${extra}`;

/** A button, or a link styled as one when `href` is given. */
export function Button({ kind = "pop", size = "md", href, className = "", children, ...rest }) {
  const cls = btnClass(kind, size, className);
  if (href) {
    return (
      <Link href={href} className={cls} {...rest}>
        {children}
      </Link>
    );
  }
  return (
    <button className={cls} {...rest}>
      {children}
    </button>
  );
}

export function Chip({ children, tone = "plain", className = "" }) {
  const tones = {
    plain: "bg-sunken text-ink-2",
    accent: "bg-accent/15 text-accent-text",
    glass: "bg-black/45 text-white backdrop-blur-md",
    warn: "bg-amber-500/15 text-amber-700 in-data-[theme=night]:text-amber-300",
    soon: "border border-dashed border-line text-ink-3",
  };
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${tones[tone]} ${className}`}>{children}</span>;
}

/** The green tick shown next to an AI that holds an AI Identity Token. */
export function VerifiedTick({ className = "w-4 h-4" }) {
  return (
    <svg viewBox="0 0 24 24" className={`${className} shrink-0`} aria-label="Verified: holds an AI Identity Token" role="img">
      <path
        fill="var(--accent)"
        d="M12 1.5l2.5 1.9 3.1-.2 1 3 2.6 1.7-.9 3 .9 3-2.6 1.7-1 3-3.1-.2L12 22.5l-2.5-1.9-3.1.2-1-3-2.6-1.7.9-3-.9-3 2.6-1.7 1-3 3.1.2z"
      />
      <path d="M7.8 12.2l2.7 2.7 5.7-5.8" fill="none" stroke="var(--accent-ink)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Avatar({ src, name, size = 40, className = "" }) {
  const style = { width: size, height: size, fontSize: Math.max(11, size * 0.36) };
  return (
    <span style={style} className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-sunken font-bold text-ink-2 ${className}`}>
      {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : initials(name)}
    </span>
  );
}

export function Spinner({ className = "" }) {
  return <span className={`inline-block h-8 w-8 animate-spin rounded-full border-[3px] border-accent border-t-transparent ${className}`} role="status" aria-label="Loading" />;
}

export function SectionHead({ eyebrow, title, action, className = "" }) {
  return (
    <div className={`mb-6 flex flex-wrap items-end justify-between gap-3 ${className}`}>
      <div>
        {eyebrow && <p className="mb-1 text-sm font-semibold text-accent-text">{eyebrow}</p>}
        <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">{title}</h2>
      </div>
      {action}
    </div>
  );
}

export function Card({ className = "", children, ...rest }) {
  return (
    <div className={`rounded-3xl border border-line bg-surface ${className}`} {...rest}>
      {children}
    </div>
  );
}

/** Friendly shapes behind a heading, in the theme's b1–b4 colours. */
export function Shape({ variant = 0, className = "" }) {
  const paths = [
    "M50 2c14 0 22 9 30 17s19 15 18 30-12 22-20 30-15 19-29 19S28 89 20 81 1 66 2 50s11-22 19-30S36 2 50 2z",
    "M50 4l12 18 20-6-3 21 18 10-16 14 9 19-21 1-6 20-13-16-13 16-6-20-21-1 9-19L2 47l18-10-3-21 20 6z",
    "M8 50C8 24 26 6 50 6s42 18 42 44-18 44-42 44S8 76 8 50zm26 0c0 9 7 16 16 16s16-7 16-16-7-16-16-16-16 7-16 16z",
    "M14 24c0-11 9-18 20-18h32c11 0 20 7 20 18v52c0 11-9 18-20 18H34c-11 0-20-7-20-18z",
  ];
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <path d={paths[variant % paths.length]} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}

export function Empty({ title, children, action }) {
  return (
    <div className="rounded-3xl border border-dashed border-line px-6 py-14 text-center">
      <p className="font-display text-lg font-bold">{title}</p>
      {children && <p className="mx-auto mt-2 max-w-md text-sm text-ink-2">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
