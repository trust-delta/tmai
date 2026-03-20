import { useCallback, useEffect, useState } from "react";
import {
  api,
  needsAttention,
  subscribeSSE,
  type AgentSnapshot,
} from "@/lib/api";

// Hook to fetch and reactively update agent list via SSE push + HTTP fallback
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
    } catch {
      // Server may not be ready yet during startup
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial fetch (retry until server is ready)
    const retryInterval = setInterval(() => {
      refresh().then(() => clearInterval(retryInterval));
    }, 500);

    // Subscribe to SSE "agents" named event for live push updates
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
