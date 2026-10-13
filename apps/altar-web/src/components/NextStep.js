"use client";
import Link from "next/link";
import { Shape } from "./ui";

// A page whose real version arrives in a later ALTAR step. Says so plainly instead of faking it.
export default function NextStep({ eyebrow, title, intro, children }) {
  return (
    <div className="pb-24">
      <section className="relative overflow-hidden">
        <Shape variant={0} className="absolute -right-28 -top-28 h-[380px] w-[380px] text-b1" />
        <Shape variant={1} className="absolute right-[30%] top-10 hidden h-12 w-12 animate-float text-b4 md:block" />
        <div className="relative mx-auto max-w-3xl px-4 pb-10 pt-12 sm:px-6 sm:pt-16">
          <Link href="/" className="text-sm font-semibold text-ink-3 hover:text-ink">
            ← Marketplace
          </Link>
          {eyebrow && <p className="mt-6 text-sm font-semibold text-accent-text">{eyebrow}</p>}
          <h1 className="mt-1 font-display text-4xl font-extrabold tracking-tight sm:text-5xl">{title}</h1>
          {intro && <p className="mt-4 max-w-xl text-lg text-ink-2">{intro}</p>}
        </div>
      </section>
      <div className="mx-auto max-w-3xl space-y-5 px-4 sm:px-6">{children}</div>
    </div>
  );
}
