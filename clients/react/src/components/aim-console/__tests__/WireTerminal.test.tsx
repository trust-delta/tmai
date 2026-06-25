// @vitest-environment jsdom
//
// WireTerminal + StatusStrip (S6) test — the hot/cold-wire PTY surface.
//
// TerminalPanel (xterm + the PTY plane) is stubbed to a props recorder, so
// the unit under test is the wire's own plumbing: the strip's segmented
// [⌁ INPUT | ⌖ SELECT] control DRIVING the controlled `inputMode` prop, the
// panel's internal transitions surfacing back via `onInputModeChange`, the
// `follow` toggle flipping the SHARED per-agent auto-scroll store (the same
// store the chromeless TerminalPanel consumes internally — asserted via a
// live probe), and the addressee accent (`ac-who-*`) / ctx readout / hint.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAutoScrollPerAgent } from "@/hooks/useAutoScrollPerAgent";
import { WireTerminal } from "../WireTerminal";

interface RecordedPanelProps {
  agentId: string;
  chromeless?: boolean;
  inputMode?: boolean;
  onInputModeChange?: (v: boolean) => void;
}
let panelProps: RecordedPanelProps | null = null;

vi.mock("@/components/terminal/TerminalPanel", () => ({
  TerminalPanel: (props: RecordedPanelProps) => {
    panelProps = props;
    return <div data-testid="wt-terminal">{props.agentId}</div>;
  },
}));

// A second live consumer of the shared per-agent auto-scroll store — stands
// in for the chromeless TerminalPanel's internal `useAutoScrollPerAgent`
// (the real panel is stubbed above). The strip's `follow` toggle must reach
// it WHILE BOTH ARE MOUNTED.
function FollowProbe({ agentId }: { agentId: string }) {
  const [follow] = useAutoScrollPerAgent(agentId);
  return <div data-testid="follow-probe">{String(follow)}</div>;
}

describe("WireTerminal — hot/cold-wire surface (S6)", () => {
  it("renders the chromeless TerminalPanel in INPUT mode with the addressee accent", () => {
    render(<WireTerminal agentId="claude:p" who="producer" addressee="producer" ctxPct={57} />);
    const wire = screen.getByTestId("ac-wire");
    expect(wire.className).toContain("ac-who-p");
    expect(wire.className).toContain("input");
    expect(panelProps).toMatchObject({
      agentId: "claude:p",
      chromeless: true,
      inputMode: true,
    });
  });

  it("strip segmented control drives the controlled inputMode prop (and the cold wire)", () => {
    render(<WireTerminal agentId="claude:p2" who="producer" addressee="producer" />);
    fireEvent.click(screen.getByRole("button", { name: /SELECT/ }));
    expect(screen.getByTestId("ac-wire").className).toContain("select");
    expect(panelProps?.inputMode).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /INPUT/ }));
    expect(screen.getByTestId("ac-wire").className).toContain("input");
    expect(panelProps?.inputMode).toBe(true);
  });

  it("the panel's internal mode transitions surface back to the wire + strip", () => {
    render(<WireTerminal agentId="claude:p3" who="producer" addressee="producer" />);
    // Drive a panel-reported select-mode transition straight through
    // onInputModeChange — the wire + strip must reflect it.
    act(() => panelProps?.onInputModeChange?.(false));
    expect(screen.getByTestId("ac-wire").className).toContain("select");
    expect(screen.getByRole("button", { name: /SELECT/ }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("follow flips the SHARED per-agent store — a simultaneous consumer sees it live", () => {
    render(
      <>
        <WireTerminal agentId="claude:f1" who="worker" addressee="attention-ui" />
        <FollowProbe agentId="claude:f1" />
      </>,
    );
    const follow = screen.getByRole("button", { name: "follow" });
    // Auto-scroll / follow defaults OFF (opt-in, #889).
    expect(follow.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByTestId("follow-probe").textContent).toBe("false");
    fireEvent.click(follow);
    expect(follow.getAttribute("aria-pressed")).toBe("true");
    // The OTHER mounted consumer (the stand-in for TerminalPanel's internal
    // auto-scroll hook) re-rendered with the new value — no remount needed.
    expect(screen.getByTestId("follow-probe").textContent).toBe("true");
  });

  it("worker and shell addressees pick the violet / green accents", () => {
    const { unmount } = render(
      <WireTerminal agentId="claude:w" who="worker" addressee="drift-cycle" />,
    );
    expect(screen.getByTestId("ac-wire").className).toContain("ac-who-w");
    expect(screen.getByTestId("ac-strip").textContent).toContain("drift-cycle");
    unmount();
    render(<WireTerminal agentId="bash:1" who="shell" addressee="tmai" />);
    expect(screen.getByTestId("ac-wire").className).toContain("ac-who-sh");
  });

  it("shows the ctx readout only when a pct is given (shells pass none)", () => {
    const { unmount } = render(
      <WireTerminal agentId="claude:c" who="producer" addressee="producer" ctxPct={57} />,
    );
    expect(screen.getByTestId("ac-strip").textContent).toContain("ctx 57%");
    unmount();
    render(<WireTerminal agentId="bash:2" who="shell" addressee="tmai" />);
    expect(screen.getByTestId("ac-strip").textContent).not.toContain("ctx");
  });

  it("renders the one-line mode hint only with `hint`, following the mode", () => {
    render(<WireTerminal agentId="claude:h" who="producer" addressee="producer" hint />);
    expect(screen.getByText(/キーストロークは agent に渡る/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /SELECT/ }));
    expect(screen.getByText(/出力テキストを選択\/コピーできる/)).toBeTruthy();
  });

  it("omits the hint by default (footer mini strips)", () => {
    render(<WireTerminal agentId="bash:3" who="shell" addressee="tmai" />);
    expect(screen.queryByText(/キーストロークは agent に渡る/)).toBeNull();
  });
});
