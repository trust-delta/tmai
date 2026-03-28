import { useCallback, useEffect } from "react";
import { api, statusName, type AgentSnapshot } from "@/lib/api";
import { cn } from "@/lib/utils";

interface AgentActionsProps {
  agent: AgentSnapshot;
  /** Whether passthrough input is active (hides approve/reject buttons) */
  passthrough?: boolean;
}

// Status bar displayed above the main panel for the selected agent
export function AgentActions({ agent, passthrough }: AgentActionsProps) {
  const name = statusName(agent.status);
  const needsPermission = name === "AwaitingApproval";
  const isProcessing = name === "Processing";
  const isIdle = name === "Idle";

  const handleApprove = useCallback(async () => {
    try {
      await api.approve(agent.id);
    } catch (e) {
      console.error("Approve failed:", e);
    }
  }, [agent.id]);

  const handleReject = useCallback(async () => {
    try {
      await api.sendKey(agent.id, "Escape");
    } catch (e) {
      console.error("Reject failed:", e);
    }
  }, [agent.id]);

  const handleKill = useCallback(async () => {
    try {
      await api.killAgent(agent.id);
    } catch (e) {
      console.error("Kill failed:", e);
    }
  }, [agent.id]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "Enter" && needsPermission) {
        e.preventDefault();
        handleApprove();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [needsPermission, handleApprove]);

  return (
    <div className="glass flex items-center gap-2 border-0 border-b border-white/5 px-3 py-2">
      <span className="text-sm font-medium text-zinc-300">
        {agent.display_name}
      </span>
      <span
        className={cn(
          "rounded px-1.5 py-0.5 text-xs",
          needsPermission && "bg-red-500/20 text-red-400",
          isProcessing && "bg-cyan-500/20 text-cyan-400",
          isIdle && "bg-zinc-500/20 text-zinc-400",
          !needsPermission &&
            !isProcessing &&
            !isIdle &&
            "bg-zinc-700/50 text-zinc-400",
        )}
      >
        {name}
      </span>

      <div className="flex-1" />

      {needsPermission && !passthrough && (
        <>
          <button
            onClick={handleApprove}
            className="rounded-md bg-emerald-500/20 px-3 py-1 text-xs font-medium text-emerald-400 transition-colors hover:bg-emerald-500/30"
            title="Ctrl+Enter"
          >
            Approve
          </button>
          <button
            onClick={handleReject}
            className="glass-card rounded-md px-3 py-1 text-xs font-medium text-zinc-300 transition-colors"
          >
            Reject
          </button>
        </>
      )}

      <button
        onClick={handleKill}
        className="rounded-md px-2 py-1 text-xs text-zinc-600 transition-colors hover:text-red-400"
        title="Kill agent"
      >
        Kill
      </button>
    </div>
  );
}
