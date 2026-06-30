// @vitest-environment jsdom
//
// Proves the contract's single-source property end to end: the xterm
// ITheme is DERIVED from the active theme (not hardcoded), and switching
// the theme pref live-updates BOTH surfaces — the terminal canvas and the
// document's `--color-*` custom properties — with no reload.

import { fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface FakeTerm {
  options: { fontSize: number };
}
const constructed: Array<{ theme: unknown; fontSize: number }> = [];
let lastInstance: FakeTerm | null = null;

vi.mock("@/lib/api", () => ({
  api: { resizeAgentTerminal: vi.fn().mockResolvedValue(undefined) },
}));

// Stable `sendKeys` identity, mirroring the real hook (it's a
// `useCallback`). Without this the create-effect's `sendKeys` dep would
// change every render and rebuild the terminal, masking the live
// font-size update path.
vi.mock("../useAgentTerminalStream", () => {
  const sendKeys = vi.fn();
  return { useAgentTerminalStream: () => ({ sendKeys }) };
});

vi.mock("@xterm/xterm", () => {
  const disposable = () => ({ dispose: vi.fn() });
  function Terminal(opts: { theme: unknown; fontSize: number }) {
    constructed.push({ theme: opts.theme, fontSize: opts.fontSize });
    const instance = {
      rows: 30,
      cols: 120,
      options: { fontSize: opts.fontSize },
      loadAddon: vi.fn(),
      open: vi.fn(),
      focus: vi.fn(),
      blur: vi.fn(),
      reset: vi.fn(),
      dispose: vi.fn(),
      scrollToBottom: vi.fn(),
      onData: vi.fn(disposable),
      onBinary: vi.fn(disposable),
      onResize: vi.fn(disposable),
      onWriteParsed: vi.fn(disposable),
    };
    lastInstance = instance;
    return instance;
  }
  return { Terminal };
});

vi.mock("@xterm/addon-fit", () => {
  function FitAddon() {
    return { fit: vi.fn() };
  }
  return { FitAddon };
});

globalThis.ResizeObserver = function ResizeObserver() {
  return { observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn() };
} as unknown as typeof ResizeObserver;

import { THEMES, themeCssVars, toXtermTheme } from "@/lib/theme";
import { UIPrefsProvider, useUIPref } from "@/lib/ui-prefs-provider";
import { useApplyTheme } from "../useActiveTheme";
import { useTerminal } from "../useTerminal";

function Harness() {
  const containerRef = useRef<HTMLDivElement>(null);
  useApplyTheme(); // CSS-var surface (rest of the UI)
  useTerminal({ agentId: "claude:x", containerRef }); // terminal surface
  const [, setMode] = useUIPref("themeMode");
  const [, setFont] = useUIPref("terminalFontSize");
  return (
    <div>
      <div ref={containerRef} />
      <button type="button" onClick={() => setMode("light")}>
        to-light
      </button>
      <button type="button" onClick={() => setFont(20)}>
        font-20
      </button>
    </div>
  );
}

function lastTheme(): unknown {
  return constructed[constructed.length - 1]?.theme;
}

describe("theme drives both surfaces (single source)", () => {
  beforeEach(() => {
    localStorage.clear();
    constructed.length = 0;
    lastInstance = null;
    document.documentElement.removeAttribute("style");
    document.documentElement.removeAttribute("data-theme");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("derives the xterm ITheme and css vars from the default (tokyonight) theme", () => {
    render(
      <UIPrefsProvider>
        <Harness />
      </UIPrefsProvider>,
    );

    // Terminal surface: ITheme is exactly the derived tokyonight theme.
    expect(lastTheme()).toEqual(toXtermTheme(THEMES.tokyonight));
    // Rest-of-UI surface: css vars on <html>.
    expect(document.documentElement.style.getPropertyValue("--color-background")).toBe("#1a1b26");
    expect(document.documentElement.dataset.theme).toBe("tokyonight");
  });

  it("switching the theme mode live-updates both surfaces", () => {
    render(
      <UIPrefsProvider>
        <Harness />
      </UIPrefsProvider>,
    );

    fireEvent.click(screen.getByText("to-light"));

    // Terminal surface rebuilt with the light (Tokyo Night Day) ITheme.
    expect(lastTheme()).toEqual(toXtermTheme(THEMES.light));
    // Rest-of-UI surface flipped to the light theme's tokens.
    expect(document.documentElement.style.getPropertyValue("--color-background")).toBe(
      themeCssVars(THEMES.light)["--color-background"],
    );
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("uses the ui-prefs terminal font size and updates it live without a rebuild", () => {
    render(
      <UIPrefsProvider>
        <Harness />
      </UIPrefsProvider>,
    );

    // Constructed with the default size (was a hardcoded 13).
    expect(constructed[0]?.fontSize).toBe(13);
    const builtCount = constructed.length;

    fireEvent.click(screen.getByText("font-20"));

    // Applied via term.options (live) — NOT by tearing down + rebuilding
    // the terminal (which would drop the PTY stream).
    expect(lastInstance?.options.fontSize).toBe(20);
    expect(constructed.length).toBe(builtCount);
  });
});
