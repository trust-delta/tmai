import { useCallback, useEffect, useState } from "react";
import { type AgentSnapshot, api } from "@/lib/api";
import { useSSE } from "@/lib/sse-provider";
import { type CoreEvent, useTauriEvents } from "./useTauriEvents";

// Hook to fetch and reactively update agent list via Tauri events + HTTP fallback
export function useAgents() {
  const [agents, setAgents] = useState<AgentSnapshot[]>([]);
  const [attentionCount, setAttentionCount] = useState(0);
  const [loading, setLoading] = useState(true);

  // Fallback: fetch via HTTP API (used for initial load)
  const refresh = useCallback(async () => {
    try {
      const agentList = await api.listAgents();
      setAgents(agentList);
      setAttentionCount(agentList.filter((a) => a.needs_attention ?? false).length);
    } catch (_e) {
      // Server may not be ready yet during startup
    } finally {
      setLoading(false);
    }
  }, []);

  // Handle Tauri core-event emissions
  const handleTauriEvent = useCallback(
    (event: CoreEvent) => {
      if (event.type === "agents-updated") {
        // Refresh agent list when AgentsUpdated event is received
        refresh();
      }
    },
    [refresh],
  );

  // Subscribe to Tauri events
  useTauriEvents(handleTauriEvent);

  useEffect(() => {
    // Initial fetch (retry until server/API is ready)
    const retryInterval = setInterval(() => {
      refresh().then(() => clearInterval(retryInterval));
    }, 500);
    return () => clearInterval(retryInterval);
  }, [refresh]);

  // Shared SSE subscription (previously opened its own EventSource)
  useSSE({
    onAgents: (agentList) => {
      setAgents(agentList);
      setAttentionCount(agentList.filter((a) => a.needs_attention ?? false).length);
      setLoading(false);
    },
  });

  return { agents, attentionCount, loading, refresh };
}
