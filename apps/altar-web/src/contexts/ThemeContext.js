"use client";
import { createContext, useContext, useState } from "react";

// ALTAR's look. Studio is the default; the others are kept for comparison in
// Settings → Advanced → Appearance lab. The choice is a per-browser convenience, kept in
// localStorage; the inline script in layout.js applies it before the first paint so the page
// never flashes the wrong theme.
export const THEMES = [
  { id: "studio", name: "Studio", note: "Default. Warm paper, ink type, bright shapes.", swatch: ["#f3f1ec", "#ffffff", "#3ddc84", "#ffb5ea", "#131613"] },
  { id: "night", name: "Night", note: "A dark market floor; the art and the green stand out.", swatch: ["#0c0d10", "#15171b", "#3ddc84", "#a8327f", "#f2f3ef"] },
  { id: "forest", name: "Forest", note: "Dark with depth: layered green-blacks.", swatch: ["#08100c", "#15211a", "#2fbf71", "#8fae3a", "#edf3ee"] },
  { id: "original", name: "Original", note: "Soban's colours: pure black and one green.", swatch: ["#000000", "#0a0a0a", "#22c55e", "#15803d", "#ffffff"] },
];
export const DEFAULT_THEME = "studio";
export const THEME_KEY = "altar_theme";

const ThemeContext = createContext({ theme: DEFAULT_THEME, setTheme: () => {} });

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => (typeof document === "undefined" ? DEFAULT_THEME : document.documentElement.dataset.theme || DEFAULT_THEME));

  const setTheme = (id) => {
    setThemeState(id);
    if (id === DEFAULT_THEME) delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = id;
    try {
      localStorage.setItem(THEME_KEY, id);
    } catch {
      // Storage can be blocked (private windows); the theme still applies for this visit.
    }
  };

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
