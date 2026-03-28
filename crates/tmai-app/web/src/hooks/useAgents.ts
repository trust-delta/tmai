import { useCallback, useEffect, useState } from "react";
import { api, needsAttention, subscribeSSE, type AgentSnapshot } from "@/lib/api";
import { useTauriEvents, type CoreEvent } from "./useTauriEvents";

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
      setAttentionCount(agentList.filter((a) => needsAttention(a.status)).length);
    } catch (e) {
      console.warn("Failed to fetch agents:", e);
      // Server may not be ready yet during startup
    } finally {
      setLoading(false);
    }
  }, []);

  // Handle Tauri core-event emissions
  const handleTauriEvent = useCallback((event: CoreEvent) => {
    if (event.type === "agents-updated") {
      // Refresh agent list when AgentsUpdated event is received
      refresh();
    }
  }, [refresh]);

  // Subscribe to Tauri events
  useTauriEvents(handleTauriEvent);

  useEffect(() => {
    // Initial fetch (retry until server/API is ready)
    const retryInterval = setInterval(() => {
      refresh().then(() => clearInterval(retryInterval));
    }, 500);

    // Also try SSE subscription as fallback
    const { unlisten } = subscribeSSE({
      onAgents: (agentList) => {
        setAgents(agentList);
        setAttentionCount(
          agentList.filter((a) => needsAttention(a.status)).length,
        );
        setLoading(false);
      },
    });

    return () => {
      clearInterval(retryInterval);
      unlisten();
    };
  }, [refresh]);

  return { agents, attentionCount, loading, refresh };
}
