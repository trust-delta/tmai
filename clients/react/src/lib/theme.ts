// WebUI theme system — the single source of truth for every colour the
// WebUI paints.
//
// WHY this module exists: the WebUI's colours used to live in two
// disconnected places — the xterm `ITheme` hardcoded in
// `hooks/useTerminal.ts` and the Tailwind `@theme` custom properties in
// `styles/globals.css`. They could (and did) drift. Everything now derives
// from one `Theme` object per named theme:
//
//   • `toXtermTheme(theme)`     → the xterm.js `ITheme` (terminal canvas)
//   • `themeCssVars(theme)`     → the `--color-*` custom properties
//   • `applyThemeToDocument()`  → writes those vars onto <html> at runtime
//
// Because both surfaces are *derived from the same palette*, they cannot
// drift: change the palette and the terminal + the Tailwind tokens move
// together. The static `@theme` block in globals.css mirrors the default
// (`tokyonight`) values purely so the very first paint (before JS runs)
// is already correct and so Tailwind can generate the utility classes —
// it is NOT a second source; runtime overrides it via
// `applyThemeToDocument`.
//
// Theme is WebUI-only presentation: it is stored in the ui-prefs
// localStorage blob, never in tmai-core config or the api-spec wire
// contract (settled convention — see `lib/ui-prefs.ts`).

import type { ITheme } from "@xterm/xterm";

export const THEME_NAMES = ["tokyonight", "zinc"] as const;
export type ThemeName = (typeof THEME_NAMES)[number];

// New installs default to Tokyo Night so the WebUI matches the operator's
// tmux out of the box.
export const DEFAULT_THEME_NAME: ThemeName = "tokyonight";

// The Tailwind semantic tokens, as their `--color-<name>` custom-property
// suffix. Iterated by `themeCssVars` so the css-var emission and the
// `Theme` shape can never fall out of sync.
export const SEMANTIC_TOKENS = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "destructive-foreground",
  "border",
  "input",
  "ring",
  "sidebar-background",
  "sidebar-foreground",
  "sidebar-primary",
  "sidebar-primary-foreground",
  "sidebar-accent",
  "sidebar-accent-foreground",
  "sidebar-border",
  "sidebar-ring",
] as const;
export type SemanticToken = (typeof SEMANTIC_TOKENS)[number];

// The 16-colour ANSI palette xterm uses for program output (claude, git,
// ls, …). Optional on a theme: when absent, `toXtermTheme` leaves these
// keys unset and xterm keeps its own built-in defaults — this is how the
// `zinc` theme stays a *faithful* snapshot of today's look (the previous
// hardcode set no ANSI colours at all).
export interface AnsiPalette {
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export interface ThemePalette {
  // ── Terminal canvas ── these feed the xterm `ITheme`. They must be
  // hex / rgb(a): xterm's colour parser does not understand `oklch()`.
  terminalBackground: string;
  terminalForeground: string;
  terminalCursor: string;
  terminalSelection: string;
  // Slider colours for xterm's own VSCode-style scrollbar. Kept on the
  // theme (not hardcoded in useTerminal) so the single-source property
  // holds for the scrollbar too; the matching 6px width stays pinned in
  // globals.css.
  scrollbar: string;
  scrollbarHover: string;
  scrollbarActive: string;
  ansi?: AnsiPalette;
  // ── Tailwind semantic tokens ── any valid CSS colour. `zinc` keeps the
  // original OKLch strings verbatim (zero-risk faithful snapshot);
  // `tokyonight` uses hex.
  tokens: Record<SemanticToken, string>;
}

export interface Theme {
  name: ThemeName;
  label: string;
  palette: ThemePalette;
}

// Shared neutral overlay for the xterm scrollbar slider. Reads correctly
// on every dark background, so both built-in themes use it; living here
// (not inlined per-theme) keeps it single-sourced.
const SCROLLBAR = "rgba(255, 255, 255, 0.08)";
const SCROLLBAR_HOVER = "rgba(255, 255, 255, 0.15)";
const SCROLLBAR_ACTIVE = "rgba(255, 255, 255, 0.18)";

// Tokyo Night (Night) — canonical folke/tokyonight palette; the anchors
// match the operator's ~/.tmux.conf so the WebUI reads the same as tmux.
const TOKYONIGHT: Theme = {
  name: "tokyonight",
  label: "Tokyo Night",
  palette: {
    terminalBackground: "#1a1b26",
    terminalForeground: "#c0caf5",
    terminalCursor: "#c0caf5",
    terminalSelection: "#283457",
    scrollbar: SCROLLBAR,
    scrollbarHover: SCROLLBAR_HOVER,
    scrollbarActive: SCROLLBAR_ACTIVE,
    ansi: {
      black: "#15161e",
      red: "#f7768e",
      green: "#9ece6a",
      yellow: "#e0af68",
      blue: "#7aa2f7",
      magenta: "#bb9af7",
      cyan: "#7dcfff",
      white: "#a9b1d6",
      brightBlack: "#414868",
      brightRed: "#f7768e",
      brightGreen: "#9ece6a",
      brightYellow: "#e0af68",
      brightBlue: "#7aa2f7",
      brightMagenta: "#bb9af7",
      brightCyan: "#7dcfff",
      brightWhite: "#c0caf5",
    },
    tokens: {
      background: "#1a1b26",
      foreground: "#c0caf5",
      card: "#1a1b26",
      "card-foreground": "#c0caf5",
      popover: "#16161e",
      "popover-foreground": "#c0caf5",
      primary: "#7aa2f7",
      "primary-foreground": "#15161e",
      secondary: "#292e42",
      "secondary-foreground": "#c0caf5",
      muted: "#292e42",
      "muted-foreground": "#565f89",
      accent: "#292e42",
      "accent-foreground": "#c0caf5",
      destructive: "#f7768e",
      "destructive-foreground": "#15161e",
      border: "#292e42",
      input: "#292e42",
      ring: "#7aa2f7",
      "sidebar-background": "#16161e",
      "sidebar-foreground": "#a9b1d6",
      "sidebar-primary": "#7aa2f7",
      "sidebar-primary-foreground": "#15161e",
      "sidebar-accent": "#292e42",
      "sidebar-accent-foreground": "#c0caf5",
      "sidebar-border": "#292e42",
      "sidebar-ring": "#7aa2f7",
    },
  },
};

// `zinc` = a faithful, non-destructive snapshot of the look that shipped
// before the theme system: the exact xterm hardcode (bg #09090b, fg
// #fafafa, cursor #a1a1aa, selection #3f3f46, NO ANSI overrides) and the
// exact OKLch `@theme` tokens. Kept verbatim — converting the OKLch
// values to hex would be lossy, and copying them as-is guarantees zero
// drift from "today".
const ZINC: Theme = {
  name: "zinc",
  label: "Zinc (legacy)",
  palette: {
    terminalBackground: "#09090b",
    terminalForeground: "#fafafa",
    terminalCursor: "#a1a1aa",
    terminalSelection: "#3f3f46",
    scrollbar: SCROLLBAR,
    scrollbarHover: SCROLLBAR_HOVER,
    scrollbarActive: SCROLLBAR_ACTIVE,
    // ansi intentionally omitted — preserves xterm's built-in palette,
    // exactly as the previous hardcode (which set no ANSI colours) did.
    tokens: {
      background: "oklch(0.145 0 0)",
      foreground: "oklch(0.985 0 0)",
      card: "oklch(0.145 0 0)",
      "card-foreground": "oklch(0.985 0 0)",
      popover: "oklch(0.145 0 0)",
      "popover-foreground": "oklch(0.985 0 0)",
      primary: "oklch(0.985 0 0)",
      "primary-foreground": "oklch(0.205 0 0)",
      secondary: "oklch(0.269 0 0)",
      "secondary-foreground": "oklch(0.985 0 0)",
      muted: "oklch(0.269 0 0)",
      "muted-foreground": "oklch(0.708 0 0)",
      accent: "oklch(0.269 0 0)",
      "accent-foreground": "oklch(0.985 0 0)",
      destructive: "oklch(0.396 0.141 25.723)",
      "destructive-foreground": "oklch(0.637 0.237 25.331)",
      border: "oklch(0.269 0 0)",
      input: "oklch(0.269 0 0)",
      ring: "oklch(0.556 0 0)",
      "sidebar-background": "oklch(0.145 0 0)",
      "sidebar-foreground": "oklch(0.708 0 0)",
      "sidebar-primary": "oklch(0.985 0 0)",
      "sidebar-primary-foreground": "oklch(0.205 0 0)",
      "sidebar-accent": "oklch(0.269 0 0)",
      "sidebar-accent-foreground": "oklch(0.985 0 0)",
      "sidebar-border": "oklch(0.269 0 0)",
      "sidebar-ring": "oklch(0.556 0 0)",
    },
  },
};

export const THEMES: Record<ThemeName, Theme> = Object.freeze({
  tokyonight: TOKYONIGHT,
  zinc: ZINC,
});

// Resolve a (possibly untrusted / persisted) name to a Theme. Returns a
// stable singleton per name — callers can safely use the result as a
// React effect dependency; identity only changes when the name changes.
export function resolveTheme(name: string | null | undefined): Theme {
  if (name && (THEME_NAMES as readonly string[]).includes(name)) {
    return THEMES[name as ThemeName];
  }
  return THEMES[DEFAULT_THEME_NAME];
}

// Derive the xterm.js `ITheme` from a theme. The ANSI keys are only set
// when the palette defines them, so `zinc` keeps xterm's defaults.
export function toXtermTheme(theme: Theme): ITheme {
  const p = theme.palette;
  const base: ITheme = {
    background: p.terminalBackground,
    foreground: p.terminalForeground,
    cursor: p.terminalCursor,
    selectionBackground: p.terminalSelection,
    scrollbarSliderBackground: p.scrollbar,
    scrollbarSliderHoverBackground: p.scrollbarHover,
    scrollbarSliderActiveBackground: p.scrollbarActive,
  };
  if (!p.ansi) return base;
  const a = p.ansi;
  return {
    ...base,
    black: a.black,
    red: a.red,
    green: a.green,
    yellow: a.yellow,
    blue: a.blue,
    magenta: a.magenta,
    cyan: a.cyan,
    white: a.white,
    brightBlack: a.brightBlack,
    brightRed: a.brightRed,
    brightGreen: a.brightGreen,
    brightYellow: a.brightYellow,
    brightBlue: a.brightBlue,
    brightMagenta: a.brightMagenta,
    brightCyan: a.brightCyan,
    brightWhite: a.brightWhite,
  };
}

// Derive the `--color-*` custom properties from a theme. Includes
// `--color-terminal-background` so the PreviewPanel / TerminalPanel
// container padding reconciles to the *same* value the xterm canvas
// paints — the two surfaces can no longer diverge.
export function themeCssVars(theme: Theme): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const token of SEMANTIC_TOKENS) {
    vars[`--color-${token}`] = theme.palette.tokens[token];
  }
  vars["--color-terminal-background"] = theme.palette.terminalBackground;
  return vars;
}

// Write a theme's css vars onto the document root (default <html>). An
// inline custom property on the root element wins over the static
// `@theme` `:root` block, so this re-skins the whole UI live with no
// reload. `data-theme` is also set for any CSS that wants to branch on
// the active theme by attribute.
export function applyThemeToDocument(
  theme: Theme,
  root: HTMLElement = document.documentElement,
): void {
  for (const [key, value] of Object.entries(themeCssVars(theme))) {
    root.style.setProperty(key, value);
  }
  root.dataset.theme = theme.name;
}
