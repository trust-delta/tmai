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

// Which mode the Aim panel (◎ Aims, Stage B convergence) opens in. `frontier`
// = the owed worklist (default — the load-bearing thesis: the panel is a WRITE
// surface, not a passive full-tree dump); `tree` = the collapsed per-repo
// navigator. Durable across sessions, browser-side; the volatile bits (the
// expanded-branch set, the search filter) stay component-local and are NOT
// persisted (a stale persisted filter would silently hide rows on next open).
export type AimMode = "frontier" | "tree";
export const AIM_MODES: readonly AimMode[] = ["frontier", "tree"];

// Drag-resized aim-console layout (S7). `aim`/`sess` are the pane fr WEIGHTS
// (the live px captured at drag end, used as `Nfr` so the panes keep scaling
// with the window); `pr` the expanded PR-rail width in px; `footer` the bash
// footer's terminal-area height in px (the mock's `--fh`). `null` = never
// dragged / reset — the console then uses AIM_CONSOLE_LAYOUT_DEFAULTS, and a
// double-click reset stores `null` rather than a copy of the defaults so a
// future default change reaches untouched layouts.
export interface AimConsoleLayout {
  aim: number;
  sess: number;
  pr: number;
  footer: number;
}

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
  // Aim panel mode. Default `frontier` — the owed worklist is the panel's
  // load-bearing thesis (NOT a passive full-tree dump). See AimMode.
  aimMode: AimMode;
  // Drag-resized aim-console layout (S7); `null` until the operator drags a
  // gutter. WebUI-only by the same convention as every other field here.
  aimConsoleLayout: AimConsoleLayout | null;
}

// Attention-strip width bounds (px). Floor keeps the section content
// (PR rows, cross-unit list) legible; ceiling stops the strip from
// starving the centre conversation. Default matches the pre-P1.1 fixed
// `w-80` (20rem = 320px) so existing users see no jump on upgrade.
export const ATTENTION_STRIP_WIDTH_MIN = 240;
export const ATTENTION_STRIP_WIDTH_MAX = 560;
export const ATTENTION_STRIP_WIDTH_DEFAULT = 320;

// aim-console layout bounds (issue #805 / the S6 mock's drag clamps). The
// PR-rail window keeps the rail's lists legible without starving the Session
// pane; the footer floor keeps at least a couple of terminal rows visible.
// The footer's UPPER bound is runtime-only (60% of the live Session pane
// height) so it cannot be enforced here — the console re-applies it on mount,
// drag and window resize.
export const AIM_CONSOLE_PR_WIDTH_MIN = 240;
export const AIM_CONSOLE_PR_WIDTH_MAX = 520;
export const AIM_CONSOLE_FOOTER_MIN = 110;

export const AIM_CONSOLE_LAYOUT_DEFAULTS: AimConsoleLayout = {
  aim: 1.18,
  sess: 1,
  pr: 320,
  footer: 180,
};

export const DEFAULT_UI_PREFS: UIPrefs = {
  theme: DEFAULT_THEME_NAME,
  terminalFontSize: 13,
  attentionStripCollapsed: false,
  attentionStripWidth: ATTENTION_STRIP_WIDTH_DEFAULT,
  rPanelExpandedSections: [],
  aimMode: "frontier",
  aimConsoleLayout: null,
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

// Same compose-with-coerce convention as clampAttentionStripWidth: the drag
// commit path (aim-console Gutters) clamps with the rule coerce applies on
// load, so neither a drag nor a hand-edited blob can persist out-of-range px.
export function clampAimConsolePrWidth(value: number): number {
  if (!Number.isFinite(value)) return AIM_CONSOLE_LAYOUT_DEFAULTS.pr;
  return Math.max(AIM_CONSOLE_PR_WIDTH_MIN, Math.min(AIM_CONSOLE_PR_WIDTH_MAX, Math.round(value)));
}

// Floor-only: the footer's ceiling (60% of the Session pane) is a LIVE
// measurement the storage layer cannot know — the console re-clamps it on
// mount / drag / window resize.
export function clampAimConsoleFooterHeight(value: number): number {
  if (!Number.isFinite(value)) return AIM_CONSOLE_LAYOUT_DEFAULTS.footer;
  return Math.max(AIM_CONSOLE_FOOTER_MIN, Math.round(value));
}

// Collapse an all-defaults layout back to `null` so a double-click reset
// CLEARS the stored layout (the issue's contract) instead of pinning a copy
// of today's defaults into every blob.
export function normalizeAimConsoleLayout(layout: AimConsoleLayout): AimConsoleLayout | null {
  const d = AIM_CONSOLE_LAYOUT_DEFAULTS;
  if (
    layout.aim === d.aim &&
    layout.sess === d.sess &&
    layout.pr === d.pr &&
    layout.footer === d.footer
  ) {
    return null;
  }
  return layout;
}

// Pane fr weights are free-form positive numbers (1.18 at rest, live px after
// a drag) — only reject the degenerate ones that would zero out a pane.
function coerceFrWeight(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback;
  return value;
}

function coerceAimConsoleLayout(value: unknown): AimConsoleLayout | null {
  if (value === null || value === undefined || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  return normalizeAimConsoleLayout({
    aim: coerceFrWeight(v.aim, AIM_CONSOLE_LAYOUT_DEFAULTS.aim),
    sess: coerceFrWeight(v.sess, AIM_CONSOLE_LAYOUT_DEFAULTS.sess),
    pr: typeof v.pr === "number" ? clampAimConsolePrWidth(v.pr) : AIM_CONSOLE_LAYOUT_DEFAULTS.pr,
    footer:
      typeof v.footer === "number"
        ? clampAimConsoleFooterHeight(v.footer)
        : AIM_CONSOLE_LAYOUT_DEFAULTS.footer,
  });
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
    aimMode: AIM_MODES.includes(r.aimMode as AimMode)
      ? (r.aimMode as AimMode)
      : DEFAULT_UI_PREFS.aimMode,
    aimConsoleLayout: coerceAimConsoleLayout(r.aimConsoleLayout),
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
