"use client";
import Link from "next/link";
import ThemePicker from "../../../components/ThemePicker";
import { AltMark, BrandLogo, setClassicMark, useClassicMark } from "../../../components/BrandLogo";

// Not linked from the main screens on purpose: reached from Settings → Advanced.
export default function AppearanceLab() {
  const classic = useClassicMark();
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
      <h2 className="mt-12 font-display text-xl font-bold">ALT mark</h2>
      <p className="mt-1 text-sm text-ink-2">The mark on &ldquo;Continue with ALT&rdquo;: the hexagon logo, or ALT&apos;s classic three bars.</p>
      <div className="mt-4 grid grid-cols-2 gap-3" role="radiogroup" aria-label="ALT mark">
        {[
          { on: false, name: "Logo", note: "The hexagon" },
          { on: true, name: "Classic", note: "Three bars" },
        ].map((o) => (
          <button
            key={o.name}
            role="radio"
            aria-checked={classic === o.on}
            onClick={() => setClassicMark(o.on)}
            className={`flex items-center gap-3 rounded-2xl border p-4 text-left transition ${classic === o.on ? "border-ink bg-surface" : "border-line hover:border-ink-3"}`}
          >
            <span className="grid h-10 w-10 place-items-center text-ink">
              {o.on ? (
                <span className="inline-grid grid-cols-3 gap-[3px]" aria-hidden="true">
                  <i className="block h-5 w-[6px] rounded-sm bg-[#1f9a5c]" />
                  <i className="block h-5 w-[6px] rounded-sm bg-[#f0802a]" />
                  <i className="block h-5 w-[6px] rounded-sm bg-current" />
                </span>
              ) : (
                <BrandLogo kind="alt" className="h-9 w-9" title="" />
              )}
            </span>
            <span>
              <span className="block font-semibold">{o.name}</span>
              <span className="block text-sm text-ink-2">{o.note}</span>
            </span>
          </button>
        ))}
      </div>
      <p className="mt-3 flex items-center gap-2 text-sm text-ink-3">
        Now: <AltMark className="h-5 w-5" />
      </p>
    </div>
  );
}

