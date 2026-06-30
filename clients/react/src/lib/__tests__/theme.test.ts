// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  applyThemeToDocument,
  DEFAULT_THEME_MODE,
  DEFAULT_THEME_NAME,
  resolveTheme,
  resolveThemeMode,
  SEMANTIC_TOKENS,
  systemPrefersLight,
  THEME_MODE_OPTIONS,
  THEME_MODES,
  THEME_NAMES,
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

  it("exposes `light` as a first-class selectable theme (migration complete)", () => {
    expect(resolveTheme("light")).toBe(THEMES.light);
    // Graduated into the selectable set once the component tree finished
    // migrating onto semantic tokens (Settings switcher + ui-prefs
    // validation both key off THEME_NAMES).
    expect(THEME_NAMES as readonly string[]).toEqual(["tokyonight", "zinc", "light"]);
  });
});

describe("theme MODE (System / Light / Dark)", () => {
  it("offers exactly the three user-facing modes, default system", () => {
    expect(THEME_MODES as readonly string[]).toEqual(["system", "light", "dark"]);
    expect(DEFAULT_THEME_MODE).toBe("system");
  });

  it("pins light → light and dark → the current dark set (tokyonight), OS-agnostic", () => {
    // Pinned modes ignore the OS signal entirely.
    expect(resolveThemeMode("light", false)).toBe("light");
    expect(resolveThemeMode("light", true)).toBe("light");
    expect(resolveThemeMode("dark", false)).toBe("tokyonight");
    expect(resolveThemeMode("dark", true)).toBe("tokyonight");
  });

  it("follows the OS signal under `system`", () => {
    expect(resolveThemeMode("system", true)).toBe("light");
    expect(resolveThemeMode("system", false)).toBe("tokyonight");
  });

  it("maps each picker option to the theme its swatch previews", () => {
    const byMode = Object.fromEntries(THEME_MODE_OPTIONS.map((o) => [o.mode, o]));
    expect(byMode.system.swatch).toBeNull(); // split swatch, no single colour
    expect(byMode.light.swatch).toBe("light");
    expect(byMode.dark.swatch).toBe("tokyonight");
    expect(THEME_MODE_OPTIONS.map((o) => o.label)).toEqual(["System", "Light", "Dark"]);
  });
});

describe("systemPrefersLight — OS prefers-color-scheme read", () => {
  const realMatchMedia = window.matchMedia;
  beforeEach(() => {
    window.matchMedia = realMatchMedia;
  });

  function stubMatchMedia(lightMatches: boolean): void {
    window.matchMedia = ((query: string) => ({
      matches: query.includes("light") ? lightMatches : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }

  it("reports the OS light preference when matchMedia matches", () => {
    stubMatchMedia(true);
    expect(systemPrefersLight()).toBe(true);
  });

  it("reports dark (false) when the OS prefers dark", () => {
    stubMatchMedia(false);
    expect(systemPrefersLight()).toBe(false);
  });

  it("falls back to dark (false) when matchMedia is unavailable", () => {
    // Some environments (older jsdom, SSR) lack matchMedia — must not throw.
    (window as { matchMedia?: unknown }).matchMedia = undefined;
    expect(systemPrefersLight()).toBe(false);
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

  it("emits the new migration-target tokens (status / surface / dim text)", () => {
    const vars = themeCssVars(THEMES.tokyonight);
    // The SEMANTIC_TOKENS loop above already covers all of them; spot
    // check the new ones are present and themed.
    const newTokens = [
      "warning",
      "success",
      "info",
      "surface",
      "surface-strong",
      "elevated",
      "hairline",
      "hairline-strong",
      "subtle-foreground",
    ] as const;
    for (const t of newTokens) {
      expect(vars[`--color-${t}`]).toBe(THEMES.tokyonight.palette.tokens[t]);
    }
    expect(vars["--color-warning"]).toBe("#e0af68");
    expect(vars["--color-surface"]).toBe("rgba(192, 202, 245, 0.05)");
  });

  it("emits glow (rgb channel triple) + brand fx vars", () => {
    const tn = themeCssVars(THEMES.tokyonight);
    expect(tn["--glow-accent"]).toBe("34 211 238");
    expect(tn["--brand-from"]).toBe("#22d3ee");
    // light retunes the glow for a light backdrop.
    const lt = themeCssVars(THEMES.light);
    expect(lt["--glow-accent"]).toBe("46 125 233");
    expect(lt["--color-background"]).toBe("#e1e2e7");
  });

  it("PR-A inert invariant: the dark themes keep the pre-theme glow literals", () => {
    // The globals.css `.glow-*` / glowPulse rewrite stayed visually
    // identical for the pre-existing dark themes only by keeping the
    // original cyan/amber/red literals. `light` is a new theme and
    // legitimately retunes the glow for a light backdrop, so it is
    // intentionally excluded from this invariant.
    for (const name of ["tokyonight", "zinc"] as const) {
      const v = themeCssVars(THEMES[name]);
      expect(v["--glow-accent"]).toBe("34 211 238");
      expect(v["--glow-warning"]).toBe("245 158 11");
      expect(v["--glow-danger"]).toBe("239 68 68");
    }
  });
});
