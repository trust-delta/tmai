// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock is hoisted before static imports
vi.mock("@/lib/api", () => ({
  api: {
    getPromptQueue: vi.fn(),
    cancelQueuedPrompt: vi.fn(),
  },
}));

// Mock sse-provider so useSSE is a no-op in unit tests.
// The onEntityUpdate subscription is exercised in the integration test block below.
let capturedSSEHandlers: Parameters<typeof import("@/lib/sse-provider").useSSE>[0] | null = null;
vi.mock("@/lib/sse-provider", () => ({
  useSSE: (handlers: unknown) => {
    capturedSSEHandlers = handlers as Parameters<typeof import("@/lib/sse-provider").useSSE>[0];
  },
}));

import type { QueuedPrompt } from "@/lib/api";
import { api } from "@/lib/api";
import { useQueuedPrompts } from "../useQueuedPrompts";

const ITEMS: QueuedPrompt[] = [
  { id: "1", prompt: "hello world", queued_at: "2026-04-20T10:00:00Z" },
  { id: "2", prompt: "do something", queued_at: "2026-04-20T10:00:01Z" },
];

describe("useQueuedPrompts", () => {
  beforeEach(() => {
    capturedSSEHandlers = null;
    vi.mocked(api.getPromptQueue).mockResolvedValue(ITEMS);
    vi.mocked(api.cancelQueuedPrompt).mockResolvedValue({ status: "cancelled" });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("populates items after initial fetch", async () => {
    const { result } = renderHook(() => useQueuedPrompts("agent-1"));
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(result.current.items[0].id).toBe("1");
  });

  it("returns empty array while API is unreachable", async () => {
    vi.mocked(api.getPromptQueue).mockRejectedValue(new Error("network error"));
    const { result } = renderHook(() => useQueuedPrompts("agent-1"));
    await waitFor(() => expect(vi.mocked(api.getPromptQueue)).toHaveBeenCalled());
    expect(result.current.items).toHaveLength(0);
  });

  it("removes item optimistically on cancel", async () => {
    const { result } = renderHook(() => useQueuedPrompts("agent-1"));
    await waitFor(() => expect(result.current.items).toHaveLength(2));

    act(() => {
      result.current.cancel("1");
    });
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].id).toBe("2");
  });

  it("does NOT re-sync when cancel returns 'cancelled'", async () => {
    vi.mocked(api.cancelQueuedPrompt).mockResolvedValue({ status: "cancelled" });
    const { result } = renderHook(() => useQueuedPrompts("agent-1"));
    await waitFor(() => expect(result.current.items).toHaveLength(2));

    const callsBefore = vi.mocked(api.getPromptQueue).mock.calls.length;
    await act(async () => {
      await result.current.cancel("1");
    });
    expect(vi.mocked(api.getPromptQueue).mock.calls.length).toBe(callsBefore);
  });

  it("does NOT re-sync when cancel returns 'already_drained' (idempotent success)", async () => {
    vi.mocked(api.cancelQueuedPrompt).mockResolvedValue({ status: "already_drained" });
    const { result } = renderHook(() => useQueuedPrompts("agent-1"));
    await waitFor(() => expect(result.current.items).toHaveLength(2));

    const callsBefore = vi.mocked(api.getPromptQueue).mock.calls.length;
    await act(async () => {
      await result.current.cancel("1");
    });
    expect(vi.mocked(api.getPromptQueue).mock.calls.length).toBe(callsBefore);
  });

  it("re-syncs via refresh after an actual failure (network / 404)", async () => {
    vi.mocked(api.cancelQueuedPrompt).mockRejectedValue(new Error("404 Not Found"));
    const { result } = renderHook(() => useQueuedPrompts("agent-1"));
    await waitFor(() => expect(result.current.items).toHaveLength(2));

    const callsBefore = vi.mocked(api.getPromptQueue).mock.calls.length;
    await act(async () => {
      await result.current.cancel("1");
    });
    await waitFor(() =>
      expect(vi.mocked(api.getPromptQueue).mock.calls.length).toBeGreaterThan(callsBefore),
    );
  });

  // Phase 2: polling replaced by SSE subscription
  it("does NOT start a polling interval on mount (SSE-driven)", () => {
    const spy = vi.spyOn(global, "setInterval");
    const { unmount } = renderHook(() => useQueuedPrompts("agent-1"));
    const pollingIntervals = spy.mock.calls.filter(([, ms]) => ms === 3000);
    expect(pollingIntervals).toHaveLength(0);
    unmount();
    spy.mockRestore();
  });

  it("registers an onEntityUpdate handler via useSSE", () => {
    renderHook(() => useQueuedPrompts("agent-1"));
    expect(capturedSSEHandlers).not.toBeNull();
    expect(typeof capturedSSEHandlers?.onEntityUpdate).toBe("function");
  });

  // #9 — notifications must be surfaced separately from the conversation input
  describe("onNewItem callback (fixes #9)", () => {
    it("fires for items that are new since the previous poll", async () => {
      const onNewItem = vi.fn();
      vi.mocked(api.getPromptQueue).mockResolvedValue([ITEMS[0]]);

      const { result } = renderHook(() => useQueuedPrompts("agent-1", onNewItem));
      await waitFor(() => expect(result.current.items).toHaveLength(1));

      // First fetch: item is new
      expect(onNewItem).toHaveBeenCalledTimes(1);
      expect(onNewItem).toHaveBeenCalledWith(ITEMS[0]);
    });

    it("does NOT fire again for items already seen on a subsequent refresh", async () => {
      const onNewItem = vi.fn();
      vi.mocked(api.getPromptQueue)
        .mockResolvedValueOnce([ITEMS[0]])
        .mockResolvedValue([ITEMS[0]]);

      const { result } = renderHook(() => useQueuedPrompts("agent-1", onNewItem));
      await waitFor(() => expect(result.current.items).toHaveLength(1));
      expect(onNewItem).toHaveBeenCalledTimes(1);

      await act(async () => {
        await result.current.refresh();
      });
      // Still only 1 call — item was already known
      expect(onNewItem).toHaveBeenCalledTimes(1);
    });

    it("fires for each genuinely new item when the queue grows", async () => {
      const onNewItem = vi.fn();
      vi.mocked(api.getPromptQueue)
        .mockResolvedValueOnce([])
        .mockResolvedValue(ITEMS);

      const { result } = renderHook(() => useQueuedPrompts("agent-1", onNewItem));
      await waitFor(() => expect(result.current.items).toHaveLength(0));
      expect(onNewItem).not.toHaveBeenCalled();

      await act(async () => {
        await result.current.refresh();
      });
      expect(onNewItem).toHaveBeenCalledTimes(2);
      expect(onNewItem).toHaveBeenCalledWith(ITEMS[0]);
      expect(onNewItem).toHaveBeenCalledWith(ITEMS[1]);
    });

    it("resets seen IDs when agentId changes so onNewItem fires for the new agent's queue", async () => {
      const onNewItem = vi.fn();
      vi.mocked(api.getPromptQueue).mockResolvedValue([ITEMS[0]]);

      const { result, rerender } = renderHook(
        ({ agentId }: { agentId: string }) => useQueuedPrompts(agentId, onNewItem),
        { initialProps: { agentId: "agent-1" } },
      );
      await waitFor(() => expect(result.current.items).toHaveLength(1));
      expect(onNewItem).toHaveBeenCalledTimes(1);

      rerender({ agentId: "agent-2" });
      await act(async () => {
        await result.current.refresh();
      });
      // Even though ITEMS[0].id is the same string, the agent switched —
      // onNewItem must fire again because state is per-agent.
      expect(onNewItem).toHaveBeenCalledTimes(2);
    });
  });

  describe("QueueUpdate entity event handling", () => {
    it("updates items when QueueUpdate Upserted event arrives for this agent", async () => {
      vi.mocked(api.getPromptQueue).mockResolvedValue([]);
      const { result } = renderHook(() => useQueuedPrompts("agent-1"));
      await waitFor(() => expect(result.current.items).toHaveLength(0));

      // Simulate a QueueUpdate SSE event arriving
      act(() => {
        capturedSSEHandlers?.onEntityUpdate?.({
          v: 1,
          event: "QueueUpdate",
          change: "Upserted",
          entity: "Queue",
          id: "agent-1",
          snapshot: { agent_id: "agent-1", agent_stable_id: "a1", agent_display_label: "A1", queue: ITEMS, total_count: 2, oldest_queued_at: ITEMS[0].queued_at },
          seq: 1 as unknown as bigint,
          ts: new Date().toISOString(),
        });
      });

      await waitFor(() => expect(result.current.items).toHaveLength(2));
      expect(result.current.items[0].id).toBe("1");
    });

    it("clears items when QueueUpdate Removed event arrives", async () => {
      const { result } = renderHook(() => useQueuedPrompts("agent-1"));
      await waitFor(() => expect(result.current.items).toHaveLength(2));

      act(() => {
        capturedSSEHandlers?.onEntityUpdate?.({
          v: 1,
          event: "QueueUpdate",
          change: "Removed",
          entity: "Queue",
          id: "agent-1",
          seq: 2 as unknown as bigint,
          ts: new Date().toISOString(),
        });
      });

      expect(result.current.items).toHaveLength(0);
    });

    it("ignores QueueUpdate events for other agents", async () => {
      const { result } = renderHook(() => useQueuedPrompts("agent-1"));
      await waitFor(() => expect(result.current.items).toHaveLength(2));

      act(() => {
        capturedSSEHandlers?.onEntityUpdate?.({
          v: 1,
          event: "QueueUpdate",
          change: "Removed",
          entity: "Queue",
          id: "agent-2", // different agent
          seq: 3 as unknown as bigint,
          ts: new Date().toISOString(),
        });
      });

      // agent-1's items unchanged
      expect(result.current.items).toHaveLength(2);
    });

    it("fires onNewItem for items arriving via SSE", async () => {
      const onNewItem = vi.fn();
      vi.mocked(api.getPromptQueue).mockResolvedValue([]);
      const { result } = renderHook(() => useQueuedPrompts("agent-1", onNewItem));
      await waitFor(() => expect(result.current.items).toHaveLength(0));

      act(() => {
        capturedSSEHandlers?.onEntityUpdate?.({
          v: 1,
          event: "QueueUpdate",
          change: "Upserted",
          entity: "Queue",
          id: "agent-1",
          snapshot: { agent_id: "agent-1", agent_stable_id: "a1", agent_display_label: "A1", queue: [ITEMS[0]], total_count: 1, oldest_queued_at: ITEMS[0].queued_at },
          seq: 4 as unknown as bigint,
          ts: new Date().toISOString(),
        });
      });

      await waitFor(() => expect(onNewItem).toHaveBeenCalledTimes(1));
      expect(onNewItem).toHaveBeenCalledWith(ITEMS[0]);
    });
  });
});
