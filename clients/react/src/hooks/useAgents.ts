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
  // Decision tmai-core@2026-05-09 Phase 4: any non-null `attention`
  // value (`"started" | "halted" | "completed"`) means the agent is
  // waiting on the user. `null` is "running normally — no UI signal".
  const attentionCount = agents.filter((a) => a.attention != null).length;

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
