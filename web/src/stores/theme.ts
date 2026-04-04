import { create } from "zustand";

export type Theme = "dark" | "light" | "system";

interface ThemeState {
  theme: Theme;
  /** Resolved to actual dark/light (resolves "system" via media query) */
  resolvedTheme: "dark" | "light";
  /** Set theme explicitly */
  setTheme: (t: Theme) => void;
  /** Cycle: dark → light → system → dark */
  cycle: () => void;
}

/** Read persisted theme or default to system */
function getInitialTheme(): Theme {
  const stored = localStorage.getItem("tmai-theme");
  if (stored === "light" || stored === "dark" || stored === "system")
    return stored;
  return "system";
}

/** Resolve "system" to actual dark/light using media query */
function resolveTheme(theme: Theme): "dark" | "light" {
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return theme;
}

const cycleOrder: Theme[] = ["dark", "light", "system"];

export const useThemeStore = create<ThemeState>((set, get) => {
  const initial = getInitialTheme();

  // Listen for OS preference changes to update resolvedTheme when theme is "system"
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", () => {
    const { theme } = get();
    if (theme === "system") {
      set({ resolvedTheme: resolveTheme("system") });
    }
  });

  return {
    theme: initial,
    resolvedTheme: resolveTheme(initial),
    setTheme: (t: Theme) => {
      localStorage.setItem("tmai-theme", t);
      set({ theme: t, resolvedTheme: resolveTheme(t) });
    },
    cycle: () => {
      const current = get().theme;
      const idx = cycleOrder.indexOf(current);
      const next = cycleOrder[(idx + 1) % cycleOrder.length];
      get().setTheme(next);
    },
  };
});

/** Sync theme to backend (fire-and-forget) */
export function syncThemeToBackend(theme: Theme): void {
  fetch("/api/settings/theme", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ theme }),
  }).catch(() => {
    /* best-effort */
  });
}

/** Load theme from backend on startup */
export async function loadThemeFromBackend(): Promise<void> {
  try {
    const res = await fetch("/api/settings/theme");
    if (!res.ok) return;
    const data = (await res.json()) as { theme: string };
    if (data.theme === "dark" || data.theme === "light" || data.theme === "system") {
      useThemeStore.getState().setTheme(data.theme);
    }
  } catch {
    /* fallback to localStorage */
  }
}
