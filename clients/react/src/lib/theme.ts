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

// User-SELECTABLE themes — drives the Settings switcher and ui-prefs
// validation. `light` is intentionally NOT here yet: it is fully defined
// (below) and resolvable so it can serve as the acceptance test for the
// semantic-token migration, but until the component tree actually
// consumes the tokens it would render broken, so it stays unreachable
// from the UI until the migration's final PR promotes it into this list.
export const THEME_NAMES = ["tokyonight", "zinc"] as const;
export type ThemeName = (typeof THEME_NAMES)[number];

// All themes in the registry (selectable + not-yet-selectable). Used by
// `resolveTheme` and `THEMES` so `light` exists and is testable now.
export const REGISTERED_THEME_NAMES = ["tokyonight", "zinc", "light"] as const;
export type RegisteredThemeName = (typeof REGISTERED_THEME_NAMES)[number];

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
  // Status families the component tree currently spells with raw
  // palette classes (amber/emerald|green/blue). `destructive` already
  // covers red/error. Added now so the migration has a target; nothing
  // consumes them yet, so emitting them is visually inert.
  "warning",
  "warning-foreground",
  "success",
  "success-foreground",
  "info",
  "info-foreground",
  // Elevation/overlay surfaces — the replacement for the ~540
  // `bg-white/N` / `border-white/N` overlays. These are an *elevation*
  // concept, not "foreground at N%", so they get dedicated tokens
  // instead of an opacity modifier on `foreground`.
  "surface",
  "surface-strong",
  "elevated",
  "hairline",
  "hairline-strong",
  // Dimmest text tier (the zinc-600/700 labels), below muted-foreground.
  "subtle-foreground",
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

// The hand-written app shell — the `body` backdrop and the `.glass*`
// translucent panels in globals.css. These are NOT Tailwind `@theme`
// tokens (the component tree doesn't consume the semantic tokens; the
// chrome is painted by these classes), so without theming them a theme
// switch would leave the whole UI looking unchanged. Emitted as plain
// `--<name>` css vars (no `--color-` prefix on purpose, so Tailwind does
// not try to generate colour utilities from gradient values).
export interface ShellPalette {
  // `body` background. May be a gradient string.
  appBg: string;
  glassBg: string;
  glassBorder: string;
  glassLightBg: string;
  glassLightBorder: string;
  glassCardBg: string;
  glassCardBorder: string;
  glassCardHoverBg: string;
  glassCardHoverBorder: string;
  glassDeepBg: string;
  glassDeepBorder: string;
}

// Decorative effects that aren't Tailwind colour tokens: the status
// glow box-shadows (`.glow-*` / `glowPulse` in globals.css) and the
// "tmai" brand gradient. Glow values are space-separated rgb *channel*
// triples (e.g. "34 211 238") so globals.css can do
// `rgb(var(--glow-accent) / 0.15)`. Emitted as plain `--glow-*` /
// `--brand-*` vars (not `--color-*`) so Tailwind doesn't mint utilities.
export interface FxPalette {
  glowAccent: string;
  glowWarning: string;
  glowDanger: string;
  brandFrom: string;
  brandTo: string;
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
  // ── App shell ── body backdrop + glass panels (see ShellPalette).
  shell: ShellPalette;
  // ── Decorative effects ── glow box-shadows + brand gradient.
  fx: FxPalette;
  // ── Tailwind semantic tokens ── any valid CSS colour. `zinc` keeps the
  // original OKLch strings verbatim (zero-risk faithful snapshot);
  // `tokyonight` uses hex.
  tokens: Record<SemanticToken, string>;
}

export interface Theme {
  name: RegisteredThemeName;
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
    shell: {
      appBg: "linear-gradient(135deg, #16161e 0%, #1a1b26 50%, #16161e 100%)",
      glassBg: "rgba(26, 27, 38, 0.6)",
      glassBorder: "rgba(192, 202, 245, 0.06)",
      glassLightBg: "rgba(41, 46, 66, 0.4)",
      glassLightBorder: "rgba(192, 202, 245, 0.08)",
      glassCardBg: "rgba(32, 36, 53, 0.5)",
      glassCardBorder: "rgba(192, 202, 245, 0.05)",
      glassCardHoverBg: "rgba(41, 46, 66, 0.6)",
      glassCardHoverBorder: "rgba(192, 202, 245, 0.1)",
      glassDeepBg: "rgba(22, 22, 30, 0.7)",
      glassDeepBorder: "rgba(192, 202, 245, 0.08)",
    },
    // glow* kept at the pre-theme literal cyan/amber/red so the
    // globals.css glow rewrite is provably inert for this (default)
    // theme; per-theme glow tuning is deferred (see PR plan).
    fx: {
      glowAccent: "34 211 238",
      glowWarning: "245 158 11",
      glowDanger: "239 68 68",
      brandFrom: "#22d3ee",
      brandTo: "#60a5fa",
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
      // `accent` is REPURPOSED: shadcn's muted-hover-surface meaning is
      // unused in this codebase (surfaces map to surface/elevated), so
      // accent is the WebUI's themed *secondary* categorical accent —
      // what the hardcoded `purple/violet` (dispatch / agent / "remote"
      // tags) migrates to. Tokyo Night magenta; distinct from primary.
      accent: "#bb9af7",
      "accent-foreground": "#15161e",
      destructive: "#f7768e",
      "destructive-foreground": "#15161e",
      warning: "#e0af68",
      "warning-foreground": "#15161e",
      success: "#9ece6a",
      "success-foreground": "#15161e",
      info: "#7dcfff",
      "info-foreground": "#15161e",
      surface: "rgba(192, 202, 245, 0.05)",
      "surface-strong": "rgba(192, 202, 245, 0.1)",
      elevated: "#24283b",
      hairline: "rgba(192, 202, 245, 0.06)",
      "hairline-strong": "rgba(192, 202, 245, 0.12)",
      "subtle-foreground": "#414868",
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
// pre-theme chrome (shell/glow verbatim, above).
//
// The semantic `tokens` below are NOT the old shadcn `@theme` OKLch
// values — those were never actually consumed by the component tree
// (the whole reason the theme didn't visibly apply). What the components
// *rendered* was hardcoded Tailwind palette classes (zinc-300, white/10,
// cyan-400, …). As each area migrates onto the semantic tokens (via
// scripts/theme-codemod.mjs), `zinc`'s token values are therefore tuned
// to the *actual* palette colours those classes produced, so the swap is
// visually near-identical under `zinc`. Where the canonical mapping
// collapses a shade range into one token (e.g. zinc-200 & zinc-300 →
// foreground) the value is set to the dominant shade; the off-shade
// deltas are sub-perceptual and intentional consolidation.
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
    // Shell values copied verbatim from the pre-theme globals.css so the
    // `zinc` chrome is pixel-identical to what shipped before.
    shell: {
      appBg: "linear-gradient(135deg, #0a0a12 0%, #0d1117 40%, #0a0f1a 70%, #0f0a18 100%)",
      glassBg: "rgba(15, 15, 25, 0.6)",
      glassBorder: "rgba(255, 255, 255, 0.06)",
      glassLightBg: "rgba(25, 25, 40, 0.4)",
      glassLightBorder: "rgba(255, 255, 255, 0.08)",
      glassCardBg: "rgba(20, 20, 35, 0.5)",
      glassCardBorder: "rgba(255, 255, 255, 0.05)",
      glassCardHoverBg: "rgba(30, 30, 50, 0.6)",
      glassCardHoverBorder: "rgba(255, 255, 255, 0.1)",
      glassDeepBg: "rgba(10, 10, 15, 0.7)",
      glassDeepBorder: "rgba(255, 255, 255, 0.08)",
    },
    // Same literal glow/brand values the pre-theme code used — keeps the
    // globals.css glow rewrite pixel-identical when `zinc` is active.
    fx: {
      glowAccent: "34 211 238",
      glowWarning: "245 158 11",
      glowDanger: "239 68 68",
      brandFrom: "#22d3ee",
      brandTo: "#60a5fa",
    },
    // Values mirror the Tailwind palette colours the components actually
    // hardcoded (zinc-200/400/600, cyan-400, red-400, amber/emerald/blue
    // -500, purple-400, white/N overlays) so the codemod swap is a
    // faithful re-skin, not a re-colour, when `zinc` is selected. Tokens
    // the canonical mapping never emits (card/popover/secondary/border/
    // input/ring/sidebar-*) keep their original neutral OKLch.
    tokens: {
      background: "oklch(0.145 0 0)",
      foreground: "#e4e4e7",
      card: "oklch(0.145 0 0)",
      "card-foreground": "oklch(0.985 0 0)",
      popover: "oklch(0.145 0 0)",
      "popover-foreground": "oklch(0.985 0 0)",
      primary: "#22d3ee",
      "primary-foreground": "oklch(0.205 0 0)",
      secondary: "oklch(0.269 0 0)",
      "secondary-foreground": "oklch(0.985 0 0)",
      muted: "oklch(0.269 0 0)",
      "muted-foreground": "#a1a1aa",
      // Repurposed secondary accent (see tokyonight). Faithful to the
      // dominant `text-purple-400` the components hardcoded.
      accent: "#c084fc",
      "accent-foreground": "#18181b",
      destructive: "#f87171",
      "destructive-foreground": "oklch(0.637 0.237 25.331)",
      warning: "#f59e0b",
      "warning-foreground": "#18181b",
      success: "#10b981",
      "success-foreground": "#18181b",
      info: "#3b82f6",
      "info-foreground": "#18181b",
      surface: "rgba(255, 255, 255, 0.05)",
      "surface-strong": "rgba(255, 255, 255, 0.1)",
      elevated: "rgba(255, 255, 255, 0.08)",
      hairline: "rgba(255, 255, 255, 0.05)",
      "hairline-strong": "rgba(255, 255, 255, 0.1)",
      "subtle-foreground": "#52525b",
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

// `light` = Tokyo Night Day (canonical folke/tokyonight-day). Defined
// and resolvable now so it is the acceptance test for the semantic-token
// migration, but kept out of THEME_NAMES (not user-selectable) until the
// component tree actually consumes the tokens — otherwise the many
// hardcoded dark palette classes would render unreadable on a light bg.
const LIGHT: Theme = {
  name: "light",
  label: "Tokyo Night Day",
  palette: {
    terminalBackground: "#e1e2e7",
    terminalForeground: "#3760bf",
    terminalCursor: "#3760bf",
    terminalSelection: "#b6bfe2",
    // White overlays vanish on a light bg — use a dark overlay so the
    // xterm scrollbar slider stays visible.
    scrollbar: "rgba(0, 0, 0, 0.12)",
    scrollbarHover: "rgba(0, 0, 0, 0.2)",
    scrollbarActive: "rgba(0, 0, 0, 0.28)",
    ansi: {
      black: "#b4b5b9",
      red: "#f52a65",
      green: "#587539",
      yellow: "#8c6c3e",
      blue: "#2e7de9",
      magenta: "#9854f1",
      cyan: "#007197",
      white: "#6172b0",
      brightBlack: "#a1a6c5",
      brightRed: "#f52a65",
      brightGreen: "#587539",
      brightYellow: "#8c6c3e",
      brightBlue: "#2e7de9",
      brightMagenta: "#9854f1",
      brightCyan: "#007197",
      brightWhite: "#3760bf",
    },
    shell: {
      appBg: "linear-gradient(135deg, #d5d6db 0%, #e1e2e7 50%, #d5d6db 100%)",
      glassBg: "rgba(255, 255, 255, 0.6)",
      glassBorder: "rgba(55, 96, 191, 0.1)",
      glassLightBg: "rgba(255, 255, 255, 0.45)",
      glassLightBorder: "rgba(55, 96, 191, 0.12)",
      glassCardBg: "rgba(255, 255, 255, 0.5)",
      glassCardBorder: "rgba(55, 96, 191, 0.08)",
      glassCardHoverBg: "rgba(255, 255, 255, 0.7)",
      glassCardHoverBorder: "rgba(55, 96, 191, 0.16)",
      glassDeepBg: "rgba(233, 233, 236, 0.75)",
      glassDeepBorder: "rgba(55, 96, 191, 0.12)",
    },
    fx: {
      glowAccent: "46 125 233",
      glowWarning: "177 92 0",
      glowDanger: "245 42 101",
      brandFrom: "#2e7de9",
      brandTo: "#9854f1",
    },
    tokens: {
      background: "#e1e2e7",
      foreground: "#3760bf",
      card: "#e9e9ec",
      "card-foreground": "#3760bf",
      popover: "#ffffff",
      "popover-foreground": "#3760bf",
      primary: "#2e7de9",
      "primary-foreground": "#e1e2e7",
      secondary: "#c4c8da",
      "secondary-foreground": "#3760bf",
      muted: "#c4c8da",
      "muted-foreground": "#6172b0",
      // Repurposed secondary accent (see tokyonight). Tokyo Night Day magenta.
      accent: "#9854f1",
      "accent-foreground": "#ffffff",
      destructive: "#f52a65",
      "destructive-foreground": "#ffffff",
      warning: "#8c6c3e",
      "warning-foreground": "#ffffff",
      success: "#587539",
      "success-foreground": "#ffffff",
      info: "#2e7de9",
      "info-foreground": "#ffffff",
      surface: "rgba(55, 96, 191, 0.05)",
      "surface-strong": "rgba(55, 96, 191, 0.1)",
      elevated: "#ffffff",
      hairline: "rgba(55, 96, 191, 0.12)",
      "hairline-strong": "rgba(55, 96, 191, 0.22)",
      "subtle-foreground": "#8990b3",
      border: "#c4c8da",
      input: "#c4c8da",
      ring: "#2e7de9",
      "sidebar-background": "#d5d6db",
      "sidebar-foreground": "#6172b0",
      "sidebar-primary": "#2e7de9",
      "sidebar-primary-foreground": "#e1e2e7",
      "sidebar-accent": "#c4c8da",
      "sidebar-accent-foreground": "#3760bf",
      "sidebar-border": "#c4c8da",
      "sidebar-ring": "#2e7de9",
    },
  },
};

export const THEMES: Record<RegisteredThemeName, Theme> = Object.freeze({
  tokyonight: TOKYONIGHT,
  zinc: ZINC,
  light: LIGHT,
});

// Resolve a (possibly untrusted / persisted) name to a Theme. Returns a
// stable singleton per name — callers can safely use the result as a
// React effect dependency; identity only changes when the name changes.
// Resolves any REGISTERED theme (incl. the not-yet-selectable `light`)
// so tests and the migration's final PR can reach it; ui-prefs still
// validates persisted values against the selectable THEME_NAMES.
export function resolveTheme(name: string | null | undefined): Theme {
  if (name && (REGISTERED_THEME_NAMES as readonly string[]).includes(name)) {
    return THEMES[name as RegisteredThemeName];
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

  // App-shell vars (no `--color-` prefix — see ShellPalette). globals.css
  // `body` and `.glass*` read these, so the chrome re-skins too instead
  // of staying frozen on the old hardcoded gradient / rgba.
  const s = theme.palette.shell;
  vars["--app-bg"] = s.appBg;
  vars["--glass-bg"] = s.glassBg;
  vars["--glass-border"] = s.glassBorder;
  vars["--glass-light-bg"] = s.glassLightBg;
  vars["--glass-light-border"] = s.glassLightBorder;
  vars["--glass-card-bg"] = s.glassCardBg;
  vars["--glass-card-border"] = s.glassCardBorder;
  vars["--glass-card-hover-bg"] = s.glassCardHoverBg;
  vars["--glass-card-hover-border"] = s.glassCardHoverBorder;
  vars["--glass-deep-bg"] = s.glassDeepBg;
  vars["--glass-deep-border"] = s.glassDeepBorder;

  // Decorative-effect vars (no `--color-` prefix). Glow values are rgb
  // channel triples so globals.css can apply its own alpha:
  // `rgb(var(--glow-accent) / 0.15)`.
  const f = theme.palette.fx;
  vars["--glow-accent"] = f.glowAccent;
  vars["--glow-warning"] = f.glowWarning;
  vars["--glow-danger"] = f.glowDanger;
  vars["--brand-from"] = f.brandFrom;
  vars["--brand-to"] = f.brandTo;
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
