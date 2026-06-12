// @vitest-environment jsdom
//
// TerminalPanel chrome / mode-prop contract (#803).
//
// S6 added OPTIONAL, default-unchanged props so the aim-console can draw its
// own chrome around the panel: `chromeless` (no TerminalSessionHeader, no
// footer bar, no focus shadow) and controlled `inputMode` +
// `onInputModeChange`. The DEFAULT rendering must stay exactly the existing
// one — header + footer present, internal mode state — which is what the
// first tests pin down. `useTerminal` (xterm + the PTY plane) is stubbed; the
// unit under test is the panel's chrome and its mode plumbing.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalPanel } from "../TerminalPanel";

const setAttachable = vi.fn();
vi.mock("@/hooks/useTerminal", () => ({
  useTerminal: () => ({
    terminal: { current: null },
    fit: vi.fn(),
    writeText: vi.fn(),
    sendKeys: vi.fn(),
    setAttachable,
    attached: true,
  }),
}));
vi.mock("@/hooks/useAgents", () => ({
  useAgents: () => ({ agents: [], attentionCount: 0, loading: false, refresh: vi.fn() }),
}));
vi.mock("../TerminalSessionHeader", () => ({
  TerminalSessionHeader: () => <div data-testid="terminal-session-header" />,
}));

// The xterm container div (the panel's only direct child div carrying the
// mouse handlers) — since #819 it sits inside a relative wrapper so the
// copy-source overlay can float over the canvas; the handler div is the
// wrapper's `h-full` child.
function termContainer(container: HTMLElement): HTMLElement {
  const el = container.querySelector("section > div.relative > div.h-full");
  if (!el) throw new Error("terminal container not found");
  return el as HTMLElement;
}

beforeEach(() => {
  setAttachable.mockClear();
});

describe("TerminalPanel — default chrome (must stay unchanged)", () => {
  it("renders the session header AND the Input/Auto footer by default", () => {
    render(<TerminalPanel agentId="claude:a1" />);
    expect(screen.getByTestId("terminal-session-header")).toBeTruthy();
    expect(screen.getByRole("button", { name: /⌨ Input/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /⇩ Auto/ })).toBeTruthy();
  });

  it("keeps the internal (uncontrolled) mode toggle working", () => {
    const { container } = render(<TerminalPanel agentId="claude:a2" />);
    fireEvent.click(screen.getByRole("button", { name: /⌨ Input/ }));
    expect(screen.getByRole("button", { name: /📋 Select/ })).toBeTruthy();
    expect(setAttachable).toHaveBeenLastCalledWith(false);
    // mousedown in select mode + empty selection on mouseup → back to input.
    fireEvent.mouseUp(termContainer(container));
    expect(screen.getByRole("button", { name: /⌨ Input/ })).toBeTruthy();
    expect(setAttachable).toHaveBeenLastCalledWith(true);
  });
});

describe("TerminalPanel — chromeless (#803 aim-console)", () => {
  it("hides the header, footer and focus shadow", () => {
    const { container } = render(<TerminalPanel agentId="claude:a3" chromeless />);
    expect(screen.queryByTestId("terminal-session-header")).toBeNull();
    expect(screen.queryByRole("button", { name: /⌨ Input/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /⇩ Auto/ })).toBeNull();
    const section = container.querySelector("section");
    expect(section?.className).not.toContain("shadow");
  });

  it("reports internal mode transitions through onInputModeChange (controlled)", () => {
    const onChange = vi.fn();
    const { container } = render(
      <TerminalPanel
        agentId="claude:a4"
        chromeless
        inputMode={true}
        onInputModeChange={onChange}
      />,
    );
    // mousedown on the terminal → the panel's own select-mode semantics fire
    // and surface to the host instead of (only) internal state.
    fireEvent.mouseDown(termContainer(container));
    expect(onChange).toHaveBeenCalledWith(false);
    expect(setAttachable).toHaveBeenLastCalledWith(false);
  });

  it("follows a host-driven inputMode prop flip (keyboard attach in lock-step)", () => {
    const { rerender } = render(
      <TerminalPanel
        agentId="claude:a5"
        chromeless
        inputMode={true}
        onInputModeChange={() => {}}
      />,
    );
    expect(setAttachable).toHaveBeenLastCalledWith(true);
    rerender(
      <TerminalPanel
        agentId="claude:a5"
        chromeless
        inputMode={false}
        onInputModeChange={() => {}}
      />,
    );
    expect(setAttachable).toHaveBeenLastCalledWith(false);
  });

  it("returns to input mode on Enter while in select mode (existing semantics, controlled)", () => {
    const onChange = vi.fn();
    const { container } = render(
      <TerminalPanel
        agentId="claude:a6"
        chromeless
        inputMode={false}
        onInputModeChange={onChange}
      />,
    );
    fireEvent.keyDown(termContainer(container), { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
