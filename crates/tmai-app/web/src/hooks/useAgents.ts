import { useCallback, useEffect, useState } from "react";
import { api, onCoreEvent, type AgentSnapshot } from "@/lib/tauri";

// Hook to fetch and reactively update agent list via Tauri IPC + CoreEvent
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
      setAgents(agentList);
      setAttentionCount(count);
    } catch {
      // Core may not be initialized yet during app startup
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial fetch (retry until core is ready)
    const retryInterval = setInterval(() => {
      refresh().then(() => clearInterval(retryInterval));
    }, 500);

    // Subscribe to CoreEvents for live updates
    const unlisten = onCoreEvent((event) => {
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
      unlisten.then((fn) => fn());
    };
  }, [refresh]);

  return { agents, attentionCount, loading, refresh };
}
