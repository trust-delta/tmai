import { useCallback, useEffect, useState } from "react";
import { api, onCoreEvent, type AgentSnapshot } from "@/lib/api";

// Hook to fetch and reactively update agent list via HTTP API + SSE
export function useAgents() {
  const [agents, setAgents] = useState<AgentSnapshot[]>([]);
  const [attentionCount, setAttentionCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [agentList, count] = await Promise.all([
        api.listAgents(),
        api.attentionCount(),
      ]);
      // Debug: uncomment to inspect agent data
      // console.log("[tmai] agents:", JSON.stringify(agentList.map(a => ({ id: a.id, pty: a.pty_session_id }))));
      setAgents(agentList);
      setAttentionCount(count);
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

    // Subscribe to CoreEvents via SSE for live updates
    const { unlisten } = onCoreEvent((event) => {
      if (
        event.type === "AgentsUpdated" ||
        event.type === "AgentAppeared" ||
        event.type === "AgentDisappeared" ||
        event.type === "AgentStatusChanged"
      ) {
        refresh();
      }
    });

    return () => {
      clearInterval(retryInterval);
      unlisten();
    };
  }, [refresh]);

  return { agents, attentionCount, loading, refresh };
}
