"use client";
import { THEMES, useTheme } from "../contexts/ThemeContext";

// ALTAR's looks, side by side, for comparing on real pages (Settings → Advanced → Appearance lab).
export default function ThemePicker() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Theme">
      {THEMES.map((t) => {
        const active = theme === t.id;
        return (
          <button
            key={t.id}
            role="radio"
            aria-checked={active}
            onClick={() => setTheme(t.id)}
            className={`rounded-3xl border-2 bg-surface p-2 text-left transition ${active ? "border-accent" : "border-line hover:border-ink/30"}`}
          >
            {/* A small preview: canvas, a card, the green and a button. */}
            <span className="block overflow-hidden rounded-[18px] p-3" style={{ background: t.swatch[0] }}>
              <span className="flex items-center gap-2 rounded-xl p-2.5" style={{ background: t.swatch[1] }}>
                <span className="h-8 w-8 rounded-lg" style={{ background: t.swatch[2] }} />
                <span className="flex-1 space-y-1.5">
                  <span className="block h-2 w-3/4 rounded-full opacity-80" style={{ background: t.swatch[4] }} />
                  <span className="block h-2 w-1/2 rounded-full opacity-30" style={{ background: t.swatch[4] }} />
                </span>
                <span className="h-5 w-10 rounded-full" style={{ background: t.swatch[3] }} />
              </span>
            </span>
            <span className="block px-2 pb-2 pt-3">
              <span className="flex items-center gap-2 font-semibold">
                {t.name}
                {active && <span className="text-xs font-semibold text-accent-text">✓ In use</span>}
              </span>
              <span className="mt-0.5 block text-sm text-ink-3">{t.note}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
