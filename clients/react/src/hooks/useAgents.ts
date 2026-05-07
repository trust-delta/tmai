import { useCallback } from "react";
import type { AgentSnapshot } from "@/lib/api";
import { useSSEContext } from "@/lib/sse-provider";
import { type CoreEvent, useTauriEvents } from "./useTauriEvents";

// Hook to access the reactive agent list from the shared SSE entity cache.
//
// Phase 2: removed per-hook api.listAgents() initial fetch + retry loop.
// Agents are seeded via api.bootstrap() in SSEProvider on mount and kept live
// by AgentUpdate entity events. useAgents now just reads from the shared cache.
export function useAgents() {
  const { cache, refreshCache } = useSSEContext();
  const { agents, loading } = cache;
  // Step 5 of the agent-state attention rebuild (decision tmai-core@2026-05-07):
  // prefer the new `attention.required` axis when present, fall back to the
  // legacy `needs_attention` boolean (#521) so older tmai-core snapshots
  // still aggregate. Step 6 retires the fallback.
  const attentionCount = agents.filter(
    (a) => a.attention?.required ?? a.needs_attention ?? false,
  ).length;

  // refreshCache triggers a full re-bootstrap; used by the Tauri event path
  // to pull a fresh snapshot when the desktop app signals an agent change.
  const refresh = useCallback(() => {
    void refreshCache();
  }, [refreshCache]);

  const handleTauriEvent = useCallback(
    (event: CoreEvent) => {
      if (event.type === "agents-updated") {
        refresh();
      }
    },
    [refresh],
  );

  useTauriEvents(handleTauriEvent);

  return { agents, attentionCount, loading, refresh };
}

export type { AgentSnapshot };
