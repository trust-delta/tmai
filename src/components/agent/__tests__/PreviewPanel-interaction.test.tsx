// @vitest-environment jsdom
// Tests for PTY mode conversation panel selection / scroll UX (#4).
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Element.prototype.scrollIntoView = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  const hang = new Promise<never>(() => {});
  return {
    ...actual,
    api: {
      getPreview: () => hang,
      getPreviewInput: () => hang,
      getTranscript: () => hang,
      getPreviewSettings: () => hang,
      getPromptQueue: vi.fn().mockResolvedValue([]),
      cancelQueuedPrompt: vi.fn().mockResolvedValue({ status: "cancelled" }),
    },
  };
});

const { PreviewPanel } = await import("../PreviewPanel");

// Helper: mock window.getSelection to return a specific string
function mockSelection(text: string) {
  const sel = {
    toString: () => text,
    rangeCount: text ? 1 : 0,
  } as unknown as Selection;
  vi.spyOn(window, "getSelection").mockReturnValue(sel);
}

describe("PreviewPanel input/select mode", () => {
  beforeEach(() => {
    mockSelection(""); // no selection by default
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts in input mode", async () => {
    render(<PreviewPanel agentId="agent-1" />);
    await waitFor(() => {
      expect(screen.getByTitle(/Input mode/)).toBeTruthy();
    });
  });

  it("plain click in input mode stays in input mode", async () => {
    render(<PreviewPanel agentId="agent-2" />);
    // Wait for initial render
    await waitFor(() => screen.getByTitle(/Input mode/));

    const log = screen.getByRole("log");
    // mousedown → switches internally to select; mouseup with no selection → cancel
    fireEvent.mouseDown(log);
    fireEvent.mouseUp(log);

    // Should be back in input mode (button title says "Input mode")
    await waitFor(() => {
      expect(screen.getByTitle(/Input mode/)).toBeTruthy();
    });
  });

  it("drag (mousedown + mouseup with selection) switches to select mode", async () => {
    render(<PreviewPanel agentId="agent-3" />);
    await waitFor(() => screen.getByTitle(/Input mode/));

    const log = screen.getByRole("log");
    fireEvent.mouseDown(log);

    // Simulate text being selected before mouseup
    mockSelection("some selected text");
    fireEvent.mouseUp(log);

    // Should remain in select mode
    await waitFor(() => {
      expect(screen.getByTitle(/Select mode/)).toBeTruthy();
    });
  });

  it("click in select mode with no selection returns to input mode", async () => {
    render(<PreviewPanel agentId="agent-4" />);
    await waitFor(() => screen.getByTitle(/Input mode/));

    // Enter select mode via button
    const modeBtn = screen.getByTitle(/Input mode/);
    fireEvent.click(modeBtn);
    await waitFor(() => screen.getByTitle(/Select mode/));

    // Click in the log area with no selection
    const log = screen.getByRole("log");
    fireEvent.mouseDown(log);
    fireEvent.mouseUp(log);

    await waitFor(() => {
      expect(screen.getByTitle(/Input mode/)).toBeTruthy();
    });
  });
});
