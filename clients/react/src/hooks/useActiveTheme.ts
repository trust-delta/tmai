// React glue over the pure `lib/theme` module.
//
// `useActiveTheme` resolves the theme the user picked in ui-prefs into a
// `Theme` object. `useApplyTheme` additionally writes that theme's css
// vars onto <html> so the whole UI re-skins live (no reload) whenever the
// pref changes — it is mounted once near the App root.

import { useEffect, useSyncExternalStore } from "react";
import {
  applyThemeToDocument,
  resolveTheme,
  resolveThemeMode,
  subscribeSystemPrefersLight,
  systemPrefersLight,
  type Theme,
} from "@/lib/theme";
import { loadUIPrefs } from "@/lib/ui-prefs";
import { useUIPrefsOptional } from "@/lib/ui-prefs-provider";

// The OS `prefers-color-scheme` as live React state. When the mode is
// `system`, an OS appearance flip re-renders consumers (and re-applies the
// theme) with no reload. `getServerSnapshot` returns false (dark) for any
// non-browser render.
export function useSystemPrefersLight(): boolean {
  return useSyncExternalStore(subscribeSystemPrefersLight, systemPrefersLight, () => false);
}

export function useActiveTheme(): Theme {
  // When a provider is present (the real app) this is reactive: changing the
  // `themeMode` pref re-renders consumers. Without one (isolated terminal unit
  // tests) fall back to the persisted / default value. The mode resolves to a
  // concrete theme via the OS signal when `system`.
  const ctx = useUIPrefsOptional();
  const mode = ctx ? ctx.prefs.themeMode : loadUIPrefs().themeMode;
  const prefersLight = useSystemPrefersLight();
  return resolveTheme(resolveThemeMode(mode, prefersLight));
}

export function useApplyTheme(): Theme {
  const theme = useActiveTheme();
  // `resolveTheme` returns a stable singleton per name, so this effect
  // only re-runs when the user actually switches themes.
  useEffect(() => {
    applyThemeToDocument(theme);
  }, [theme]);
  return theme;
}

// The xterm font size from ui-prefs (px). Same provider-optional fallback
// as useActiveTheme so the terminal-wiring unit tests (rendered without a
// provider) keep working.
export function useTerminalFontSize(): number {
  const ctx = useUIPrefsOptional();
  return ctx ? ctx.prefs.terminalFontSize : loadUIPrefs().terminalFontSize;
}
