"use client";
import Link from "next/link";
import ThemePicker from "../../../components/ThemePicker";

// Not linked from the main screens on purpose: reached from Settings → Advanced.
export default function AppearanceLab() {
  return (
    <div className="mx-auto max-w-2xl px-4 pb-24 pt-8 sm:px-6 sm:pt-12">
      <Link href="/settings" className="text-sm font-semibold text-ink-3 hover:text-ink">
        ← Settings
      </Link>
      <h1 className="mt-3 font-display text-4xl font-extrabold tracking-tight">Appearance lab</h1>
      <p className="mt-2 text-ink-2">Switch ALTAR&apos;s look, then browse to compare. Saved in this browser only.</p>
      <div className="mt-8">
        <ThemePicker />
      </div>
    </div>
  );
}
