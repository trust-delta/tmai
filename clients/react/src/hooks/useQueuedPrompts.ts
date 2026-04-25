import { useCallback, useEffect, useRef, useState } from "react";
import type { QueuedPrompt } from "@/lib/api";
import { api } from "@/lib/api";
import { useSSE } from "@/lib/sse-provider";
import type { QueueAgentEntry } from "@/types/generated/QueueAgentEntry";

// Subscribes to the pending send_prompt queue for an agent via QueueUpdate
// SSE entity events (Phase 2 — no polling).
//
// Optimistically removes cancelled items; re-syncs on cancel failure
// (race: agent became idle and flushed the queue simultaneously).
//
// onNewItem fires for each queue item that was not present in the previous
// snapshot. Callers use this to surface incoming notifications in a UI surface
// that is isolated from the conversation input (fixes #9).
export function useQueuedPrompts(agentId: string, onNewItem?: (item: QueuedPrompt) => void) {
  const [items, setItems] = useState<QueuedPrompt[]>([]);
  const knownIdsRef = useRef(new Set<string>());
  const onNewItemRef = useRef(onNewItem);
  onNewItemRef.current = onNewItem;

  const applyQueue = useCallback((newQueue: QueuedPrompt[]) => {
    for (const item of newQueue) {
      if (!knownIdsRef.current.has(item.id)) {
        onNewItemRef.current?.(item);
      }
    }
    knownIdsRef.current = new Set(newQueue.map((q) => q.id));
    setItems(newQueue);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const queue = await api.getPromptQueue(agentId);
      applyQueue(queue);
    } catch {
      // Endpoint not yet reachable (backend may be starting up); treat as empty.
    }
  }, [agentId, applyQueue]);

  const cancel = useCallback(
    async (promptId: string) => {
      setItems((prev) => prev.filter((item) => item.id !== promptId));
      try {
        await api.cancelQueuedPrompt(agentId, promptId);
        // Both "cancelled" and "already_drained" are success statuses —
        // the optimistic remove already matches reality; no re-sync needed.
      } catch {
        // Actual failure (network, 404 on unknown agent, etc.) — re-sync.
        void refresh();
      }
    },
    [agentId, refresh],
  );

  // Reset known-IDs when switching agents so the onNewItem contract
  // ("fire for genuinely new arrivals") starts fresh per agent.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional reset on agent switch
  useEffect(() => {
    knownIdsRef.current = new Set();
  }, [agentId]);

  // Initial fetch (once, no polling) — provides data before the first QueueUpdate event.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Live updates via QueueUpdate entity events — replaces the 3 s polling interval.
  useSSE({
    onEntityUpdate: (envelope) => {
      if (envelope.entity !== "Queue" || envelope.id !== agentId) return;
      if (envelope.change === "Removed") {
        knownIdsRef.current = new Set();
        setItems([]);
      } else if (envelope.snapshot != null) {
        const entry = envelope.snapshot as QueueAgentEntry;
        // Generated QueuedPrompt uses `origin: ActionOrigin | null`; api-http uses `origin?: ActionOrigin`.
        // Both shapes are structurally identical at runtime; cast to satisfy the api-http type.
        applyQueue(entry.queue as QueuedPrompt[]);
      }
    },
  });

  return { items, cancel, refresh };
}
