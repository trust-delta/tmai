// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { QueuedPrompt } from "@/lib/api";

// ── jsdom stubs for DOM APIs not implemented in jsdom ──
globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Element.prototype.scrollIntoView = vi.fn();

// xterm's internal browser-services use matchMedia / canvas APIs that
// jsdom doesn't ship; we stub `useTerminal` instead so the panel mounts
// without trying to spin up a real terminal.
vi.mock("@/hooks/useTerminal", () => ({
  useTerminal: () => ({
    terminal: { current: null },
    fit: vi.fn(),
    writeText: vi.fn(),
    sendKeys: vi.fn(),
    setAttachable: vi.fn(),
    attached: true,
  }),
}));

// ── mock @/lib/sse-provider — useSSE is a no-op in these unit tests ──
vi.mock("@/lib/sse-provider", () => ({
  useSSE: vi.fn(),
}));

// ── mock @/lib/api ──
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  const hang = new Promise<never>(() => {});
  return {
    ...actual,
    api: {
      // Hanging stub — keeps `useAgentTerminalStream` parked in
      // `subscribing` state so the hook never attempts to construct a
      // WebSocket against the missing test backend.
      subscribeTerminal: () => hang,
      getTranscript: () => hang,
      getPromptQueue: vi.fn(),
      cancelQueuedPrompt: vi.fn().mockResolvedValue({ status: "cancelled" }),
    },
  };
});

const { api } = await import("@/lib/api");
const { PreviewPanel } = await import("../PreviewPanel");

const QUEUED: QueuedPrompt[] = [
  {
    id: "q1",
    prompt: "run the tests",
    queued_at: "2026-04-20T10:00:00Z",
    origin: { kind: "Agent", id: "main:0.0", is_producer: true, cwd: null },
  },
];

describe("PreviewPanel queue badge", () => {
  it("shows queue badge when prompt-queue returns items", async () => {
    vi.mocked(api.getPromptQueue).mockResolvedValue(QUEUED);
    render(<PreviewPanel agentId="test-agent" />);
    // Badge button carries the count in its title attribute
    await waitFor(() => {
      expect(screen.getByTitle(/queued/)).toBeTruthy();
    });
  });

  it("badge is absent when queue is empty", async () => {
    vi.mocked(api.getPromptQueue).mockResolvedValue([]);
    render(<PreviewPanel agentId="test-agent" />);
    await waitFor(() => expect(vi.mocked(api.getPromptQueue)).toHaveBeenCalled());
    expect(screen.queryByTitle(/queued/)).toBeNull();
  });
});
