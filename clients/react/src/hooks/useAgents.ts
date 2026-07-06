import { useCallback } from "react";
import { type AgentSnapshot, hasAttention } from "@/lib/api";
import { useSSEContext } from "@/lib/sse-provider";

// Hook to access the reactive agent list from the shared SSE entity cache.
//
// Phase 2: removed per-hook api.listAgents() initial fetch + retry loop.
// Agents are seeded via api.bootstrap() in SSEProvider on mount and kept live
// by AgentUpdate entity events. useAgents now just reads from the shared cache.
export function useAgents() {
  const { cache, refreshCache } = useSSEContext();
  const { agents, loading } = cache;
  // Shared `hasAttention` predicate (see `@/lib/api`): count of agents on
  // the user-blocked axis, fed to the StatusBar badge.
  const attentionCount = agents.filter(hasAttention).length;

  // refreshCache triggers a full re-bootstrap; callers use it to pull a fresh
  // snapshot after an out-of-band mutation (e.g. launching a Producer) that
  // isn't yet reflected by the live AgentUpdate SSE stream.
  const refresh = useCallback(() => {
    void refreshCache();
  }, [refreshCache]);

  return { agents, attentionCount, loading, refresh };
}

export type { AgentSnapshot };
