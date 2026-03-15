import { useCallback, useEffect, useState } from "react";
import { fetchPreview } from "../api/client";
import type { PreviewResponse } from "../types/agent";

/** Poll preview content for a specific agent (1s interval).
 *  Pauses when the tab is hidden. */
export function useAgentPreview(agentId: string | null) {
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [visible, setVisible] = useState(!document.hidden);

  // Track page visibility
  const onVisibilityChange = useCallback(() => {
    setVisible(!document.hidden);
  }, []);

  useEffect(() => {
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [onVisibilityChange]);

  useEffect(() => {
    // Clear stale preview on agent change
    setPreview(null);

    if (!agentId || !visible) return;

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
  }, [agentId, visible]);

  return preview;
}
