import { useCallback, useEffect, useState } from "react";
import { api, type WorktreeSnapshot } from "@/lib/api";
import { useSSE } from "@/lib/sse-provider";

// Hook to fetch and reactively update worktree list via SSE events.
//
// Worktree state is produced exclusively by the Poller and exposed through
// `worktree_created` / `worktree_removed` events (#425). Refetch triggers are:
//   - worktree_* named events (immediate, post-action)
//   - SSE reconnect (EventSource doesn't replay missed named events — any
//     offline window would otherwise leave the UI on stale data)
// The previous `onAgents`-debounced refresh is gone: it was a catch-all that
// fired per agent tick and caused transient stale renders right after
// delete/create, which is exactly the problem #425 resolves.
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
    refresh();
  }, [refresh]);

  useSSE({
    onEvent: (eventName) => {
      if (eventName === "worktree_created" || eventName === "worktree_removed") {
        refresh();
      }
    },
    onReconnect: refresh,
  });

  return { worktrees, loading, refresh };
}
