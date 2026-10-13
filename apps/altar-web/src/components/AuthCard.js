"use client";
import { Logo } from "./Header";
import { Shape } from "./ui";

// The sign-in, sign-up and handoff screens share one calm card.
export function AuthCard({ title, subtitle, children }) {
  return (
    <div className="relative flex min-h-[calc(100vh-4rem)] items-center justify-center overflow-hidden px-4 py-16">
      <Shape variant={0} className="absolute -right-32 -top-24 h-[420px] w-[420px] text-b1" />
      <Shape variant={2} className="absolute -bottom-32 -left-24 h-[320px] w-[320px] text-b2" />
      <div className="relative w-full max-w-[420px] rounded-[32px] border border-line bg-surface p-8 shadow-card sm:p-10">
        <Logo className="mb-8" />
        <h1 className="font-display text-3xl font-extrabold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-2 text-ink-2">{subtitle}</p>}
        <div className="mt-8 flex flex-col gap-5">{children}</div>
      </div>
    </div>
  );
}

export const ErrorText = ({ children }) =>
  children ? (
    <p role="alert" className="rounded-2xl bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-600">
      {children}
    </p>
  ) : null;

export const OneAccountNote = () => <p className="text-center text-sm text-ink-3">One ALT account for ALTER, ALTERA and ALTAR.</p>;
