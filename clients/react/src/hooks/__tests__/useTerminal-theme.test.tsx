// @vitest-environment jsdom
//
// Proves the contract's single-source property end to end: the xterm
// ITheme is DERIVED from the active theme (not hardcoded), and switching
// the theme pref live-updates BOTH surfaces — the terminal canvas and the
// document's `--color-*` custom properties — with no reload.

import { fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const constructed: Array<{ theme: unknown }> = [];

vi.mock("@/lib/api", () => ({
  api: { resizeAgentTerminal: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock("../useAgentTerminalStream", () => ({
  useAgentTerminalStream: () => ({ sendKeys: vi.fn() }),
}));

vi.mock("@xterm/xterm", () => {
  const disposable = () => ({ dispose: vi.fn() });
  function Terminal(opts: { theme: unknown }) {
    constructed.push({ theme: opts.theme });
    return {
      rows: 30,
      cols: 120,
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

import { THEMES, toXtermTheme } from "@/lib/theme";
import { UIPrefsProvider, useUIPref } from "@/lib/ui-prefs-provider";
import { useApplyTheme } from "../useActiveTheme";
import { useTerminal } from "../useTerminal";

function Harness() {
  const containerRef = useRef<HTMLDivElement>(null);
  useApplyTheme(); // CSS-var surface (rest of the UI)
  useTerminal({ agentId: "claude:x", containerRef }); // terminal surface
  const [, setTheme] = useUIPref("theme");
  return (
    <div>
      <div ref={containerRef} />
      <button type="button" onClick={() => setTheme("zinc")}>
        to-zinc
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

  it("switching the theme pref live-updates both surfaces", () => {
    render(
      <UIPrefsProvider>
        <Harness />
      </UIPrefsProvider>,
    );

    fireEvent.click(screen.getByText("to-zinc"));

    // Terminal surface rebuilt with the zinc ITheme (no ANSI overrides).
    expect(lastTheme()).toEqual(toXtermTheme(THEMES.zinc));
    // Rest-of-UI surface flipped to zinc's verbatim OKLch tokens.
    expect(document.documentElement.style.getPropertyValue("--color-background")).toBe(
      "oklch(0.145 0 0)",
    );
    expect(document.documentElement.dataset.theme).toBe("zinc");
  });
});
