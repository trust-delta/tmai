import { useEffect, useState } from "react";
import { fetchPreview } from "../api/client";
import type { PreviewResponse } from "../types/agent";

/** Poll preview content for a specific agent (1s interval) */
export function useAgentPreview(agentId: string | null) {
  const [preview, setPreview] = useState<PreviewResponse | null>(null);

  useEffect(() => {
    if (!agentId) {
      setPreview(null);
      return;
    }

    let cancelled = false;

    async function poll() {
      try {
        const data = await fetchPreview(agentId!);
        if (!cancelled) setPreview(data);
      } catch {
        // ignore errors silently
      }
    }

    poll();
    const timer = setInterval(poll, 1000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [agentId]);

  return preview;
}
