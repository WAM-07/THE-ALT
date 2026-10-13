"use client";
import { createContext, useContext, useState } from "react";

// ALTAR's look. The choice is a per-browser convenience, kept in localStorage; the inline script in
// layout.js applies it before the first paint so the page never flashes the wrong theme.
export const THEMES = [
  { id: "original", name: "Original", note: "Soban's design: pure black and one green.", swatch: ["#000000", "#0a0a0a", "#22c55e", "#ffffff"] },
  { id: "forest", name: "Forest", note: "Dark with depth: layered green-blacks, softer text.", swatch: ["#08100c", "#15211a", "#2aa866", "#edf3ee"] },
  { id: "daylight", name: "Daylight", note: "Light marketplace with a dark hero.", swatch: ["#f3f6f4", "#ffffff", "#1f9a5c", "#12201a"] },
];
export const THEME_KEY = "altar_theme";

const ThemeContext = createContext({ theme: "original", setTheme: () => {} });

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => (typeof document === "undefined" ? "original" : document.documentElement.dataset.theme || "original"));

  const setTheme = (id) => {
    setThemeState(id);
    if (id === "original") delete document.documentElement.dataset.theme;
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
