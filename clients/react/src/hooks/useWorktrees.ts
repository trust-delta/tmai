import { useCallback } from "react";
import type { WorktreeSnapshot } from "@/lib/api";
import { useSSE, useSSEContext } from "@/lib/sse-provider";

// Hook to access the reactive worktree list from the shared SSE entity cache.
//
// Phase 2: removed per-hook api.listWorktrees() initial fetch.
// Worktrees are seeded via api.bootstrap() in SSEProvider and kept live by
// WorktreeUpdate entity events.
//
// Legacy worktree_created / worktree_removed named events are still registered
// here as a compatibility shim (Phase 1 backend still emits them in parallel);
// they trigger refreshCache to stay consistent during the Phase 3 transition.
export function useWorktrees(): {
  worktrees: WorktreeSnapshot[];
  loading: boolean;
  refresh: () => void;
} {
  const { cache, refreshCache } = useSSEContext();
  const { worktrees, loading } = cache;

  const refresh = useCallback(() => {
    void refreshCache();
  }, [refreshCache]);

  useSSE({
    // Legacy named events still fire during Phase 1/2; use as supplemental trigger.
    onEvent: (eventName) => {
      if (eventName === "worktree_created" || eventName === "worktree_removed") {
        refresh();
      }
    },
    onReconnect: refresh,
  });

  return { worktrees, loading, refresh };
}
