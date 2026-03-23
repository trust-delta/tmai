import { useCallback, useEffect, useState } from "react";
import { api, subscribeSSE, type WorktreeSnapshot } from "@/lib/api";

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

  useEffect(() => {
    // Initial fetch
    refresh();

    // Re-fetch on worktree or agent changes
    const { unlisten } = subscribeSSE({
      onAgents: () => {
        refresh();
      },
      onEvent: (eventName) => {
        if (
          eventName === "worktree_created" ||
          eventName === "worktree_removed"
        ) {
          refresh();
        }
      },
    });

    return () => {
      unlisten();
    };
  }, [refresh]);

  return { worktrees, loading, refresh };
}
