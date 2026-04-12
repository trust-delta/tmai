import { useCallback, useEffect, useState } from "react";
import { api, type WorktreeSnapshot } from "@/lib/api";
import { useSSE } from "@/lib/sse-provider";

// Hook to fetch and reactively update worktree list via SSE events.
// Only refreshes on worktree_created / worktree_removed events —
// relying on onAgents previously produced a flood of /api/worktrees GETs
// because the backend emits `agents` on every hook tick (PreToolUse,
// PostToolUse, UserPromptSubmit, …) while the orchestrator is active.
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
  });

  return { worktrees, loading, refresh };
}
