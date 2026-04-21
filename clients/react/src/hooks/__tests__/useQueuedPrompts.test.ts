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

import type { QueuedPrompt } from "@/lib/api";
import { api } from "@/lib/api";
import { useQueuedPrompts } from "../useQueuedPrompts";

const ITEMS: QueuedPrompt[] = [
  { id: "1", prompt: "hello world", queued_at: "2026-04-20T10:00:00Z" },
  { id: "2", prompt: "do something", queued_at: "2026-04-20T10:00:01Z" },
];

describe("useQueuedPrompts", () => {
  beforeEach(() => {
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

  it("registers a 3 s polling interval on mount", () => {
    const spy = vi.spyOn(global, "setInterval");
    const { unmount } = renderHook(() => useQueuedPrompts("agent-1"));
    const intervals = spy.mock.calls.filter(([, ms]) => ms === 3000);
    expect(intervals).toHaveLength(1);
    unmount();
    spy.mockRestore();
  });

  // #9 — notifications must be surfaced separately from the conversation input
  describe("onNewItem callback (fixes #9)", () => {
    it("fires for items that are new since the previous poll", async () => {
      const onNewItem = vi.fn();
      vi.mocked(api.getPromptQueue).mockResolvedValue([ITEMS[0]]);

      const { result } = renderHook(() => useQueuedPrompts("agent-1", onNewItem));
      await waitFor(() => expect(result.current.items).toHaveLength(1));

      // First poll: both items are new
      expect(onNewItem).toHaveBeenCalledTimes(1);
      expect(onNewItem).toHaveBeenCalledWith(ITEMS[0]);
    });

    it("does NOT fire again for items already seen on a subsequent poll", async () => {
      const onNewItem = vi.fn();
      // First poll returns item 1
      vi.mocked(api.getPromptQueue)
        .mockResolvedValueOnce([ITEMS[0]])
        // Second poll returns same item 1
        .mockResolvedValue([ITEMS[0]]);

      const { result } = renderHook(() => useQueuedPrompts("agent-1", onNewItem));
      await waitFor(() => expect(result.current.items).toHaveLength(1));
      expect(onNewItem).toHaveBeenCalledTimes(1);

      // Trigger a manual refresh (simulates the 3-second interval)
      await act(async () => {
        await result.current.refresh();
      });
      // Still only 1 call — item was already known
      expect(onNewItem).toHaveBeenCalledTimes(1);
    });

    it("fires for each genuinely new item when the queue grows", async () => {
      const onNewItem = vi.fn();
      // First poll: empty queue
      vi.mocked(api.getPromptQueue)
        .mockResolvedValueOnce([])
        // Second poll: two new items
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

    // Guards against UUID collisions across agents and preserves the
    // "fire for genuinely new arrivals" contract as a per-agent invariant.
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
});
