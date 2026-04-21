import { useCallback, useEffect, useRef, useState } from "react";
import type { QueuedPrompt } from "@/lib/api";
import { api } from "@/lib/api";

// Polls the pending send_prompt queue for an agent every 3 s.
// Optimistically removes cancelled items; re-syncs on cancel failure
// (race: agent became idle and flushed the queue simultaneously).
//
// onNewItem fires for each queue item that was not present in the previous
// poll. Callers use this to surface incoming notifications in a UI surface
// that is isolated from the conversation input (fixes #9).
export function useQueuedPrompts(agentId: string, onNewItem?: (item: QueuedPrompt) => void) {
  const [items, setItems] = useState<QueuedPrompt[]>([]);
  // Track known IDs so we can fire onNewItem only for genuinely new arrivals.
  const knownIdsRef = useRef(new Set<string>());
  // Keep callback in a ref so refresh() doesn't need to re-register on every render.
  const onNewItemRef = useRef(onNewItem);
  onNewItemRef.current = onNewItem;

  const refresh = useCallback(async () => {
    try {
      const queue = await api.getPromptQueue(agentId);
      // Notify caller about items that arrived since the last poll.
      for (const item of queue) {
        if (!knownIdsRef.current.has(item.id)) {
          onNewItemRef.current?.(item);
        }
      }
      knownIdsRef.current = new Set(queue.map((q) => q.id));
      setItems(queue);
    } catch {
      // Endpoint not yet reachable (backend may be starting up); treat as empty.
    }
  }, [agentId]);

  const cancel = useCallback(
    async (promptId: string) => {
      setItems((prev) => prev.filter((item) => item.id !== promptId));
      try {
        await api.cancelQueuedPrompt(agentId, promptId);
        // Both "cancelled" and "already_drained" are success statuses —
        // the optimistic remove already matches reality; no re-sync needed.
      } catch {
        // Actual failure (network, 404 on unknown agent, etc.) — re-sync.
        refresh();
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

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
  }, [refresh]);

  return { items, cancel, refresh };
}
