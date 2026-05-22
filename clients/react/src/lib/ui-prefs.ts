// WebUI-only preferences. Lives in the browser, not in tmai-core's
// config.toml — these describe how *this* WebUI presents the same backend
// data, and have no meaning for the CLI / TUI clients. Keeping them
// browser-side avoids polluting the core wire contract with client-specific
// state.
//
// The whole pref bag is persisted as one JSON blob under a single
// `tmai:ui:prefs` localStorage key so cross-tab sync (storage events)
// fires once per change instead of once per field.

import type { DisplayMode } from "@/components/layout/DisplayModeSelector";
import type { PaneTab } from "@/components/layout/TabbedPaneLayout";
import { DEFAULT_THEME_NAME, THEME_NAMES, type ThemeName } from "@/lib/theme";

export type RightPanelTab = "git" | "markdown";

export interface UIPrefs {
  displayMode: DisplayMode;
  tabsActive: PaneTab;
  rightPanelTab: RightPanelTab;
  splitRatioH: number;
  splitRatioV: number;
  tripleOuterRatio: number;
  tripleInnerRatio: number;
  // WebUI colour theme. Presentation-only; lives here (not in tmai-core
  // config / api-spec) by the same convention as every other field.
  theme: ThemeName;
  // xterm font size (px). Presentation-only, browser-side; replaces the
  // old hardcoded `fontSize: 13` in useTerminal.
  terminalFontSize: number;
  // Persistent right-hand attention strip collapse state
  // (`doc/decisions/2026-05-14-react-producer-console-rebuild.md`
  // §Refinement 2026-05-22 — L/C/R co-visible layout). Presentation-only,
  // browser-side: the operator can fold the strip to a rail to reclaim
  // width when the centre conversation/multipane is busy. Default open so
  // a clean-state user sees the co-visible attention surface immediately.
  attentionStripCollapsed: boolean;
}

export const DEFAULT_UI_PREFS: UIPrefs = {
  displayMode: "split-h",
  tabsActive: "preview",
  rightPanelTab: "git",
  splitRatioH: 0.5,
  splitRatioV: 0.5,
  tripleOuterRatio: 0.55,
  tripleInnerRatio: 0.5,
  theme: DEFAULT_THEME_NAME,
  terminalFontSize: 13,
  attentionStripCollapsed: false,
};

export const UI_PREFS_STORAGE_KEY = "tmai:ui:prefs";

const VALID_DISPLAY_MODES: readonly DisplayMode[] = ["tabs", "split-h", "split-v", "triple"];
const VALID_PANE_TABS: readonly PaneTab[] = ["preview", "git", "markdown"];
const VALID_RIGHT_PANEL_TABS: readonly RightPanelTab[] = ["git", "markdown"];
const VALID_THEMES: readonly ThemeName[] = THEME_NAMES;

const RATIO_MIN = 0.2;
const RATIO_MAX = 0.8;

// Keep the terminal legible and the layout sane at the extremes.
export const TERMINAL_FONT_SIZE_MIN = 8;
export const TERMINAL_FONT_SIZE_MAX = 32;

function clampRatio(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(RATIO_MIN, Math.min(RATIO_MAX, value));
}

function clampFontSize(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(TERMINAL_FONT_SIZE_MIN, Math.min(TERMINAL_FONT_SIZE_MAX, Math.round(value)));
}

// Validate each field individually so a partially corrupt blob still
// recovers the good fields and only resets the bad ones to default.
function coercePrefs(raw: unknown): UIPrefs {
  if (raw === null || typeof raw !== "object") return { ...DEFAULT_UI_PREFS };
  const r = raw as Record<string, unknown>;
  return {
    displayMode: VALID_DISPLAY_MODES.includes(r.displayMode as DisplayMode)
      ? (r.displayMode as DisplayMode)
      : DEFAULT_UI_PREFS.displayMode,
    tabsActive: VALID_PANE_TABS.includes(r.tabsActive as PaneTab)
      ? (r.tabsActive as PaneTab)
      : DEFAULT_UI_PREFS.tabsActive,
    rightPanelTab: VALID_RIGHT_PANEL_TABS.includes(r.rightPanelTab as RightPanelTab)
      ? (r.rightPanelTab as RightPanelTab)
      : DEFAULT_UI_PREFS.rightPanelTab,
    splitRatioH: clampRatio(r.splitRatioH, DEFAULT_UI_PREFS.splitRatioH),
    splitRatioV: clampRatio(r.splitRatioV, DEFAULT_UI_PREFS.splitRatioV),
    tripleOuterRatio: clampRatio(r.tripleOuterRatio, DEFAULT_UI_PREFS.tripleOuterRatio),
    tripleInnerRatio: clampRatio(r.tripleInnerRatio, DEFAULT_UI_PREFS.tripleInnerRatio),
    theme: VALID_THEMES.includes(r.theme as ThemeName)
      ? (r.theme as ThemeName)
      : DEFAULT_UI_PREFS.theme,
    terminalFontSize: clampFontSize(r.terminalFontSize, DEFAULT_UI_PREFS.terminalFontSize),
    attentionStripCollapsed:
      typeof r.attentionStripCollapsed === "boolean"
        ? r.attentionStripCollapsed
        : DEFAULT_UI_PREFS.attentionStripCollapsed,
  };
}

// One-shot migration from the pre-`tmai:ui:` ad-hoc keys. Runs the first
// time loadUIPrefs sees no consolidated blob; old keys are deleted after a
// successful merge so this only fires once per browser. The
// `tmai:dev-show-auto-discovered` key from the now-retired auto-discovery
// flow is listed in LEGACY_KEYS purely so it gets swept away even though
// no field consumes it.
const LEGACY_KEYS = [
  "tmai:split-ratio",
  "tmai:split-v-ratio",
  "tmai:split-enabled",
  "tmai:dev-show-auto-discovered",
] as const;

function migrateLegacyPrefs(): Partial<UIPrefs> {
  const out: Partial<UIPrefs> = {};
  try {
    const splitH = localStorage.getItem("tmai:split-ratio");
    if (splitH !== null) {
      const parsed = Number.parseFloat(splitH);
      if (Number.isFinite(parsed))
        out.splitRatioH = clampRatio(parsed, DEFAULT_UI_PREFS.splitRatioH);
    }
    const splitV = localStorage.getItem("tmai:split-v-ratio");
    if (splitV !== null) {
      const parsed = Number.parseFloat(splitV);
      if (Number.isFinite(parsed))
        out.splitRatioV = clampRatio(parsed, DEFAULT_UI_PREFS.splitRatioV);
    }
  } catch {
    // localStorage unavailable — skip migration silently.
  }
  return out;
}

function clearLegacyKeys(): void {
  try {
    for (const key of LEGACY_KEYS) localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

function hasAnyLegacyKey(): boolean {
  try {
    return LEGACY_KEYS.some((k) => localStorage.getItem(k) !== null);
  } catch {
    return false;
  }
}

export function loadUIPrefs(): UIPrefs {
  try {
    const raw = localStorage.getItem(UI_PREFS_STORAGE_KEY);
    if (raw !== null) {
      return coercePrefs(JSON.parse(raw));
    }
    // No consolidated blob yet — sweep up any legacy keys (carry over the
    // ones we still understand, drop the rest) so a returning user starts
    // clean even if they only had the now-retired dev-show-auto-discovered
    // key set. We must NOT drop the legacy keys until the merged blob has
    // actually persisted — if the write fails (quota / private mode) the
    // legacy values are the only surviving record of the user's prefs and
    // need to stick around so the next load can retry the migration.
    if (hasAnyLegacyKey()) {
      const merged = { ...DEFAULT_UI_PREFS, ...migrateLegacyPrefs() };
      let persisted = false;
      try {
        localStorage.setItem(UI_PREFS_STORAGE_KEY, JSON.stringify(merged));
        persisted = true;
      } catch {
        // Save failed — keep legacy keys in place and retry next load.
      }
      if (persisted) clearLegacyKeys();
      return merged;
    }
    return { ...DEFAULT_UI_PREFS };
  } catch {
    return { ...DEFAULT_UI_PREFS };
  }
}

export function saveUIPrefs(prefs: UIPrefs): void {
  try {
    localStorage.setItem(UI_PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // ignore (private mode / quota)
  }
}
