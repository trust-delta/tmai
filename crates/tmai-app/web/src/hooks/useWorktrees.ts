import { useCallback, useEffect, useRef, useState } from "react";
import { api, type WorktreeSnapshot } from "@/lib/api";
import { useSSE } from "@/lib/sse-provider";

// Hook to fetch and reactively update worktree list via SSE events
export function useWorktrees(): {
  worktrees: WorktreeSnapshot[];
  loading: boolean;
  refresh: () => void;
} {
  const [worktrees, setWorktrees] = useState<WorktreeSnapshot[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const list = await api.listWorktrees();
      setWorktrees(list);
    } catch {
      // Server may not be ready yet
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch only on mount; subsequent updates are debounced below.
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Debounce rapid onAgents bursts (cold-start PR flood, monitor ticks)
  // so we don't re-GET /api/worktrees per event. 250ms collapses a burst
  // into one refresh.
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current) return;
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      refresh();
    }, 250);
  }, [refresh]);

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, []);

  useSSE({
    onAgents: scheduleRefresh,
    onEvent: (eventName) => {
      if (eventName === "worktree_created" || eventName === "worktree_removed") {
        refresh();
      }
    },
  });

  return { worktrees, loading, refresh };
}
