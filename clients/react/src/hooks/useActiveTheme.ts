// React glue over the pure `lib/theme` module.
//
// `useActiveTheme` resolves the theme the user picked in ui-prefs into a
// `Theme` object. `useApplyTheme` additionally writes that theme's css
// vars onto <html> so the whole UI re-skins live (no reload) whenever the
// pref changes — it is mounted once near the App root.

import { useEffect } from "react";
import { applyThemeToDocument, resolveTheme, type Theme } from "@/lib/theme";
import { loadUIPrefs } from "@/lib/ui-prefs";
import { useUIPrefsOptional } from "@/lib/ui-prefs-provider";

export function useActiveTheme(): Theme {
  // When a provider is present (the real app) this is reactive: changing
  // the `theme` pref re-renders consumers. Without one (isolated terminal
  // unit tests) fall back to the persisted / default value.
  const ctx = useUIPrefsOptional();
  const name = ctx ? ctx.prefs.theme : loadUIPrefs().theme;
  return resolveTheme(name);
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
