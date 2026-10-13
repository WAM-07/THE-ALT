"use client";
import { THEMES, useTheme } from "../contexts/ThemeContext";

// Three looks for ALTAR, side by side, so the owner can compare them on real pages.
export default function ThemePicker({ compact = false }) {
  const { theme, setTheme } = useTheme();
  return (
    <div className={compact ? "grid grid-cols-3 gap-2" : "space-y-3"} role="radiogroup" aria-label="Theme">
      {THEMES.map((t) => {
        const active = theme === t.id;
        return (
          <button
            key={t.id}
            role="radio"
            aria-checked={active}
            onClick={() => setTheme(t.id)}
            className={`w-full text-left rounded-2xl border transition-all ${compact ? "p-3" : "p-4 flex items-center gap-4"} ${
              active ? "border-green-500 bg-green-500/10" : "border-white/10 bg-raised hover:border-green-500/40"
            }`}
          >
            <span className={`flex -space-x-1.5 ${compact ? "mb-2" : ""}`} aria-hidden="true">
              {t.swatch.map((c, i) => (
                <span key={i} className="w-5 h-5 rounded-full border border-white/20" style={{ background: c }}></span>
              ))}
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-2 text-sm font-black text-white">
                {t.name}
                {active && <span className="text-[9px] uppercase tracking-widest text-green-400">✓ On</span>}
              </span>
              {!compact && <span className="block text-xs text-white/50 mt-0.5">{t.note}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}
