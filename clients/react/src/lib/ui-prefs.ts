// WebUI-only preferences. Lives in the browser, not in tmai-core's
// config.toml — these describe how *this* WebUI presents the same backend
// data, and have no meaning for the CLI / TUI clients. Keeping them
// browser-side avoids polluting the core wire contract with client-specific
// state.
//
// The whole pref bag is persisted as one JSON blob under a single
// `tmai:ui:prefs` localStorage key so cross-tab sync (storage events)
// fires once per change instead of once per field.

import { DEFAULT_THEME_NAME, THEME_NAMES, type ThemeName } from "@/lib/theme";

export interface UIPrefs {
  // WebUI colour theme. Presentation-only; lives here (not in tmai-core
  // config / api-spec) by the same convention as every other field.
  theme: ThemeName;
  // xterm font size (px). Presentation-only, browser-side; replaces the
  // old hardcoded `fontSize: 13` in useTerminal.
  terminalFontSize: number;
  // Persistent right-hand R panel (project artifact inventory) collapse
  // state. Default open so a clean-state user sees the co-visible R
  // surface immediately. Same pref key kept post-rename for back-compat
  // (storage migration would be churn for no benefit).
  attentionStripCollapsed: boolean;
  // Persistent right-hand R panel width in px. Drag-resized via the
  // shared useSplitPane drag engine; persisted here so the operator's
  // chosen width survives reloads / cross-tab. See clampAttentionStripWidth.
  attentionStripWidth: number;
  // Which R-panel accordion sections the operator has expanded. Default
  // empty (all collapsed) — the R panel is operator-driven; tmai does not
  // pick a default to expand (approach 2026-05-29 §"tmai は何を絶対しない"
  // rule 6: no tmai-selected default expand).
  rPanelExpandedSections: string[];
}

// Attention-strip width bounds (px). Floor keeps the section content
// (PR rows, cross-unit list) legible; ceiling stops the strip from
// starving the centre conversation. Default matches the pre-P1.1 fixed
// `w-80` (20rem = 320px) so existing users see no jump on upgrade.
export const ATTENTION_STRIP_WIDTH_MIN = 240;
export const ATTENTION_STRIP_WIDTH_MAX = 560;
export const ATTENTION_STRIP_WIDTH_DEFAULT = 320;

export const DEFAULT_UI_PREFS: UIPrefs = {
  theme: DEFAULT_THEME_NAME,
  terminalFontSize: 13,
  attentionStripCollapsed: false,
  attentionStripWidth: ATTENTION_STRIP_WIDTH_DEFAULT,
  rPanelExpandedSections: [],
};

export const UI_PREFS_STORAGE_KEY = "tmai:ui:prefs";

const VALID_THEMES: readonly ThemeName[] = THEME_NAMES;

// Keep the terminal legible and the layout sane at the extremes.
export const TERMINAL_FONT_SIZE_MIN = 8;
export const TERMINAL_FONT_SIZE_MAX = 32;

function clampFontSize(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(TERMINAL_FONT_SIZE_MIN, Math.min(TERMINAL_FONT_SIZE_MAX, Math.round(value)));
}

// Clamp a candidate strip width to the legal px window, rounding to a whole
// pixel. Exported so the drag commit path (App.tsx) clamps the committed
// width with the same rule coercePrefs applies on load — the two guards
// then compose: the drag can't persist an out-of-range width, and a
// hand-edited / stale blob is still corrected on read.
export function clampAttentionStripWidth(value: number): number {
  if (!Number.isFinite(value)) return ATTENTION_STRIP_WIDTH_DEFAULT;
  return Math.max(
    ATTENTION_STRIP_WIDTH_MIN,
    Math.min(ATTENTION_STRIP_WIDTH_MAX, Math.round(value)),
  );
}

function clampStripWidth(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return clampAttentionStripWidth(value);
}

// Validate each field individually so a partially corrupt blob still
// recovers the good fields and only resets the bad ones to default.
function coercePrefs(raw: unknown): UIPrefs {
  if (raw === null || typeof raw !== "object") return { ...DEFAULT_UI_PREFS };
  const r = raw as Record<string, unknown>;
  return {
    theme: VALID_THEMES.includes(r.theme as ThemeName)
      ? (r.theme as ThemeName)
      : DEFAULT_UI_PREFS.theme,
    terminalFontSize: clampFontSize(r.terminalFontSize, DEFAULT_UI_PREFS.terminalFontSize),
    attentionStripCollapsed:
      typeof r.attentionStripCollapsed === "boolean"
        ? r.attentionStripCollapsed
        : DEFAULT_UI_PREFS.attentionStripCollapsed,
    attentionStripWidth: clampStripWidth(
      r.attentionStripWidth,
      DEFAULT_UI_PREFS.attentionStripWidth,
    ),
    rPanelExpandedSections: coerceExpandedSections(r.rPanelExpandedSections),
  };
}

function coerceExpandedSections(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

// One-shot sweep of pre-`tmai:ui:` ad-hoc keys, run the first time
// loadUIPrefs sees no consolidated blob. The split keys
// (`tmai:split-ratio` / `tmai:split-v-ratio` / `tmai:split-enabled`) drove
// the now-retired git/docs multipane (DR `2026-05-14-react-producer-
// console-rebuild.md` §Refinement 2026-05-22 Fork B) and the
// `tmai:dev-show-auto-discovered` key the retired auto-discovery flow —
// none carry a value into the current schema, so the sweep just deletes
// them rather than migrating anything.
const LEGACY_KEYS = [
  "tmai:split-ratio",
  "tmai:split-v-ratio",
  "tmai:split-enabled",
  "tmai:dev-show-auto-discovered",
] as const;

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
    // No consolidated blob yet — sweep up any legacy keys. They carry no
    // value into the current schema (the prefs they drove are retired), so
    // we persist plain defaults and delete the keys. We must NOT drop the
    // legacy keys until the blob has actually persisted: if the write fails
    // (quota / private mode) we leave them so the next load can retry the
    // sweep instead of silently losing the signal that one existed.
    if (hasAnyLegacyKey()) {
      const merged = { ...DEFAULT_UI_PREFS };
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
