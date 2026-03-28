// Comprehensive event handler for all CoreEvent types from Tauri
import { useCallback } from "react";
import { useTauriEvents, type CoreEvent } from "./useTauriEvents";

export interface AppEventHandlers {
  onAgentsUpdated?: () => void;
  onAgentStatusChanged?: (target: string) => void;
  onAgentAppeared?: (target: string) => void;
  onAgentDisappeared?: (target: string) => void;
  onTeamsUpdated?: () => void;
  onTeammateIdle?: (teamName: string, memberName: string) => void;
  onTaskCompleted?: (taskId: string) => void;
  onConfigChanged?: () => void;
  onWorktreeCreated?: (name: string) => void;
  onWorktreeRemoved?: (name: string) => void;
  onInstructionsLoaded?: () => void;
  onAgentStopped?: (target: string, reason?: string) => void;
  onContextCompacting?: (target: string, count?: number) => void;
  onReviewReady?: () => void;
  onReviewLaunched?: () => void;
  onReviewCompleted?: () => void;
  onWorktreeSetupCompleted?: (name: string) => void;
  onWorktreeSetupFailed?: (name: string, error?: string) => void;
  onUsageUpdated?: () => void;
}

export function useAppEvents(handlers: AppEventHandlers) {
  const handleEvent = useCallback((event: CoreEvent) => {
    switch (event.type) {
      case "agents-updated":
        handlers.onAgentsUpdated?.();
        break;
      case "agent-status-changed":
        if (event.data && typeof event.data === "object" && "target" in event.data) {
          handlers.onAgentStatusChanged?.((event.data as { target: string }).target);
        }
        break;
      case "agent-appeared":
        if (event.data && typeof event.data === "object" && "target" in event.data) {
          handlers.onAgentAppeared?.((event.data as { target: string }).target);
        }
        break;
      case "agent-disappeared":
        if (event.data && typeof event.data === "object" && "target" in event.data) {
          handlers.onAgentDisappeared?.((event.data as { target: string }).target);
        }
        break;
      case "teams-updated":
        handlers.onTeamsUpdated?.();
        break;
      case "teammate-idle":
        if (event.data && typeof event.data === "object") {
          const data = event.data as { team_name?: string; member_name?: string };
          handlers.onTeammateIdle?.(data.team_name || "", data.member_name || "");
        }
        break;
      case "task-completed":
        if (event.data && typeof event.data === "object" && "task_id" in event.data) {
          handlers.onTaskCompleted?.((event.data as { task_id: string }).task_id);
        }
        break;
      case "config-changed":
        handlers.onConfigChanged?.();
        break;
      case "worktree-created":
        if (event.data && typeof event.data === "object" && "name" in event.data) {
          handlers.onWorktreeCreated?.((event.data as { name: string }).name);
        }
        break;
      case "worktree-removed":
        if (event.data && typeof event.data === "object" && "name" in event.data) {
          handlers.onWorktreeRemoved?.((event.data as { name: string }).name);
        }
        break;
      case "instructions-loaded":
        handlers.onInstructionsLoaded?.();
        break;
      case "agent-stopped":
        if (event.data && typeof event.data === "object") {
          const data = event.data as { target?: string; reason?: string };
          handlers.onAgentStopped?.(data.target || "", data.reason);
        }
        break;
      case "context-compacting":
        if (event.data && typeof event.data === "object") {
          const data = event.data as { target?: string; count?: number };
          handlers.onContextCompacting?.(data.target || "", data.count);
        }
        break;
      case "review-ready":
        handlers.onReviewReady?.();
        break;
      case "review-launched":
        handlers.onReviewLaunched?.();
        break;
      case "review-completed":
        handlers.onReviewCompleted?.();
        break;
      case "worktree-setup-completed":
        if (event.data && typeof event.data === "object" && "name" in event.data) {
          handlers.onWorktreeSetupCompleted?.((event.data as { name: string }).name);
        }
        break;
      case "worktree-setup-failed":
        if (event.data && typeof event.data === "object") {
          const data = event.data as { name?: string; error?: string };
          handlers.onWorktreeSetupFailed?.(data.name || "", data.error);
        }
        break;
      case "usage-updated":
        handlers.onUsageUpdated?.();
        break;
    }
  }, [handlers]);

  useTauriEvents(handleEvent);
}
