// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// xterm pulls a canvas in via @xterm/xterm; jsdom doesn't implement it,
// and our smoke test only checks the dispatcher branch — stub the heavy
// children so neither code path actually mounts xterm or AnsiUp.
vi.mock("../PreviewPanelLegacy", () => ({
  PreviewPanelLegacy: ({ agentId }: { agentId: string }) => (
    <div data-testid="legacy-panel">{agentId}</div>
  ),
}));
vi.mock("../PreviewPanelXterm", () => ({
  PreviewPanelXterm: ({ agentId }: { agentId: string }) => (
    <div data-testid="xterm-panel">{agentId}</div>
  ),
}));

const { PreviewPanel } = await import("../PreviewPanel");

afterEach(() => {
  localStorage.clear();
});

describe("PreviewPanel dispatcher", () => {
  it("renders the legacy panel when the xterm flag is unset (default)", () => {
    render(<PreviewPanel agentId="claude:abc" />);
    expect(screen.getByTestId("legacy-panel").textContent).toBe("claude:abc");
    expect(screen.queryByTestId("xterm-panel")).toBeNull();
  });

  it("renders the legacy panel when the xterm flag is set to anything other than 'true'", () => {
    localStorage.setItem("tmai:preview-xterm", "1");
    render(<PreviewPanel agentId="claude:abc" />);
    expect(screen.getByTestId("legacy-panel")).not.toBeNull();
    expect(screen.queryByTestId("xterm-panel")).toBeNull();
  });

  it("renders the xterm panel when the flag is exactly 'true'", () => {
    localStorage.setItem("tmai:preview-xterm", "true");
    render(<PreviewPanel agentId="claude:abc" />);
    expect(screen.getByTestId("xterm-panel").textContent).toBe("claude:abc");
    expect(screen.queryByTestId("legacy-panel")).toBeNull();
  });
});
