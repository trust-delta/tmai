import { useCallback, useEffect } from "react";
import { type AgentSnapshot, api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface AgentActionsProps {
  agent: AgentSnapshot;
  /** Whether passthrough input is active (hides approve/reject buttons) */
  passthrough?: boolean;
}

// Status bar displayed above the main panel for the selected agent.
//
// Decision tmai-core@2026-05-09 Phase 4: the wire `attention` is a flat
// enum (`"started" | "halted" | "completed"` + `null`). Map onto the
// same trio of UI lanes the layout already uses:
//
// - `needsPermission` ↔ `"halted"` — at a permission/selection prompt.
// - `isIdle` ↔ `"started"` or `"completed"` — agent is waiting for the
//   next user prompt (just spawned, or just finished a turn).
// - `isProcessing` ↔ `null` — agent is running, no UI signal needed.
export function AgentActions({ agent, passthrough }: AgentActionsProps) {
  const attention = agent.attention ?? null;
  const needsPermission = attention === "halted";
  const isIdle = attention === "started" || attention === "completed";
  const isProcessing = !needsPermission && !isIdle;
  const name = needsPermission
    ? "Halted"
    : attention === "completed"
      ? "Done"
      : attention === "started"
        ? "Started"
        : "Active";

  const handleApprove = useCallback(async () => {
    try {
      await api.approve(agent.target);
    } catch (_e) {}
  }, [agent.target]);

  const handleReject = useCallback(async () => {
    try {
      await api.sendKey(agent.target, "Escape");
    } catch (_e) {}
  }, [agent.target]);

  const handleKill = useCallback(async () => {
    try {
      await api.killAgent(agent.target);
    } catch (_e) {}
  }, [agent.target]);

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
    <div className="glass flex flex-wrap items-center gap-2 border-0 border-b border-white/5 px-3 py-2">
      <span className="truncate text-sm font-medium text-zinc-300">{agent.display_name}</span>
      <span
        className={cn(
          "shrink-0 rounded px-1.5 py-0.5 text-xs",
          needsPermission && "bg-red-500/20 text-red-400",
          isProcessing && "bg-cyan-500/20 text-cyan-400",
          isIdle && "bg-zinc-500/20 text-zinc-400",
          !needsPermission && !isProcessing && !isIdle && "bg-zinc-700/50 text-zinc-400",
        )}
      >
        {name}
      </span>

      <div className="flex-1" />

      {needsPermission && !passthrough && (
        <>
          <button
            type="button"
            onClick={handleApprove}
            className="touch-target-sm rounded-md bg-emerald-500/20 px-3 py-1.5 text-xs font-medium text-emerald-400 transition-colors hover:bg-emerald-500/30"
            title="Ctrl+Enter"
          >
            Approve
          </button>
          <button
            type="button"
            onClick={handleReject}
            className="touch-target-sm glass-card rounded-md px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors"
          >
            Reject
          </button>
        </>
      )}

      <button
        type="button"
        onClick={handleKill}
        className="touch-target-sm rounded-md px-2 py-1.5 text-xs text-zinc-600 transition-colors hover:text-red-400"
        title="Kill agent"
      >
        Kill
      </button>
    </div>
  );
}
