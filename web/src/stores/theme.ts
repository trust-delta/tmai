import { create } from "zustand";

type Theme = "dark" | "light";

interface ThemeState {
  theme: Theme;
  toggle: () => void;
}

/** Read persisted theme or default to dark */
function getInitialTheme(): Theme {
  const stored = localStorage.getItem("tmai-theme");
  if (stored === "light" || stored === "dark") return stored;
  return "dark";
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: getInitialTheme(),
  toggle: () =>
    set((s) => {
      const next = s.theme === "dark" ? "light" : "dark";
      localStorage.setItem("tmai-theme", next);
      return { theme: next };
    }),
}));
