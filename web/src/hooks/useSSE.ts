import { useEffect, useState } from "react";
import { useAuthStore } from "../stores/auth";
import { useAgentsStore } from "../stores/agents";
import { createSSE } from "../api/sse";
import type { Agent } from "../types/agent";

/** Hook that manages SSE connection and pushes agents into Zustand */
export function useSSE() {
  const token = useAuthStore((s) => s.token);
  const setAgents = useAgentsStore((s) => s.setAgents);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!token) return;

    const sse = createSSE(
      token,
      (data) => {
        try {
          const agents: Agent[] = JSON.parse(data);
          setAgents(agents);
        } catch {
          // ignore malformed data
        }
      },
      () => setConnected(true),
      () => setConnected(false),
    );

    return () => sse.close();
  }, [token, setAgents]);

  return connected;
}
