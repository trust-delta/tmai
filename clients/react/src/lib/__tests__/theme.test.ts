// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  applyThemeToDocument,
  DEFAULT_THEME_NAME,
  resolveTheme,
  SEMANTIC_TOKENS,
  THEMES,
  themeCssVars,
  toXtermTheme,
} from "../theme";

describe("theme registry", () => {
  it("resolves a known theme to its definition", () => {
    expect(resolveTheme("zinc")).toBe(THEMES.zinc);
    expect(resolveTheme("tokyonight")).toBe(THEMES.tokyonight);
  });

  it("falls back to the default theme for unknown / nullish names", () => {
    expect(resolveTheme("does-not-exist")).toBe(THEMES[DEFAULT_THEME_NAME]);
    expect(resolveTheme(null)).toBe(THEMES[DEFAULT_THEME_NAME]);
    expect(resolveTheme(undefined)).toBe(THEMES[DEFAULT_THEME_NAME]);
  });

  it("returns a stable singleton (safe as a React effect dependency)", () => {
    expect(resolveTheme("tokyonight")).toBe(resolveTheme("tokyonight"));
  });

  it("defaults to tokyonight", () => {
    expect(DEFAULT_THEME_NAME).toBe("tokyonight");
  });
});

describe("toXtermTheme — derived, not hardcoded", () => {
  it("maps the tokyonight palette including the full 16-colour ANSI set", () => {
    const t = toXtermTheme(THEMES.tokyonight);
    expect(t.background).toBe("#1a1b26");
    expect(t.foreground).toBe("#c0caf5");
    expect(t.cursor).toBe("#c0caf5");
    expect(t.selectionBackground).toBe("#283457");
    // ANSI is set so program output (claude/git/ls) shifts to Tokyo Night.
    expect(t.red).toBe("#f7768e");
    expect(t.green).toBe("#9ece6a");
    expect(t.blue).toBe("#7aa2f7");
    expect(t.brightBlack).toBe("#414868");
    expect(t.brightWhite).toBe("#c0caf5");
  });

  it("preserves the exact pre-theme zinc hardcode and sets NO ANSI overrides", () => {
    const t = toXtermTheme(THEMES.zinc);
    expect(t.background).toBe("#09090b");
    expect(t.foreground).toBe("#fafafa");
    expect(t.cursor).toBe("#a1a1aa");
    expect(t.selectionBackground).toBe("#3f3f46");
    // No ANSI keys → xterm keeps its built-in palette, exactly as the
    // previous hardcode (which set none) did.
    expect(t.red).toBeUndefined();
    expect(t.brightWhite).toBeUndefined();
  });
});

describe("themeCssVars / applyThemeToDocument — the CSS-var surface", () => {
  it("emits a --color-* var for every semantic token plus terminal bg", () => {
    const vars = themeCssVars(THEMES.tokyonight);
    for (const token of SEMANTIC_TOKENS) {
      expect(vars[`--color-${token}`]).toBe(THEMES.tokyonight.palette.tokens[token]);
    }
    // Reconciles the PreviewPanel/TerminalPanel container divergence.
    expect(vars["--color-terminal-background"]).toBe(THEMES.tokyonight.palette.terminalBackground);
  });

  it("keeps zinc's original OKLch tokens verbatim (faithful snapshot)", () => {
    const vars = themeCssVars(THEMES.zinc);
    expect(vars["--color-background"]).toBe("oklch(0.145 0 0)");
    expect(vars["--color-terminal-background"]).toBe("#09090b");
  });

  it("emits app-shell vars so the chrome (body + glass) re-skins too", () => {
    const tn = themeCssVars(THEMES.tokyonight);
    expect(tn["--app-bg"]).toBe(THEMES.tokyonight.palette.shell.appBg);
    expect(tn["--glass-bg"]).toBe(THEMES.tokyonight.palette.shell.glassBg);
    expect(tn["--glass-deep-border"]).toBe(THEMES.tokyonight.palette.shell.glassDeepBorder);

    // zinc keeps the exact pre-theme globals.css chrome (pixel-faithful).
    const z = themeCssVars(THEMES.zinc);
    expect(z["--app-bg"]).toBe(
      "linear-gradient(135deg, #0a0a12 0%, #0d1117 40%, #0a0f1a 70%, #0f0a18 100%)",
    );
    expect(z["--glass-bg"]).toBe("rgba(15, 15, 25, 0.6)");
  });

  beforeEach(() => {
    document.documentElement.removeAttribute("style");
    document.documentElement.removeAttribute("data-theme");
  });

  it("writes the active theme's vars + data-theme onto <html>", () => {
    applyThemeToDocument(THEMES.tokyonight);
    const root = document.documentElement;
    expect(root.style.getPropertyValue("--color-background")).toBe("#1a1b26");
    expect(root.style.getPropertyValue("--color-terminal-background")).toBe("#1a1b26");
    expect(root.dataset.theme).toBe("tokyonight");

    // Switching overrides the previous inline values (live re-skin).
    applyThemeToDocument(THEMES.zinc);
    expect(root.style.getPropertyValue("--color-background")).toBe("oklch(0.145 0 0)");
    expect(root.style.getPropertyValue("--color-terminal-background")).toBe("#09090b");
    expect(root.dataset.theme).toBe("zinc");
  });
});
