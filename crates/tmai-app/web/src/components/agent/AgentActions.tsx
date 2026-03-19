import { useState, useCallback, useEffect } from "react";
import { api, statusName, type AgentSnapshot } from "@/lib/api";
import { cn } from "@/lib/utils";

interface AgentActionsProps {
  agent: AgentSnapshot;
}

// Action bar displayed above the terminal for the selected agent
export function AgentActions({ agent }: AgentActionsProps) {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  const name = statusName(agent.status);
  const needsPermission = name === "AwaitingApproval";
  const isProcessing = name === "Processing";
  const isIdle = name === "Idle";

  const handleApprove = useCallback(async () => {
    try {
      await api.approve(agent.target);
    } catch (e) {
      console.error("Approve failed:", e);
    }
  }, [agent.target]);

  const handleReject = useCallback(async () => {
    try {
      await api.sendKey(agent.target, "Escape");
    } catch (e) {
      console.error("Reject failed:", e);
    }
  }, [agent.target]);

  const handleSendText = useCallback(async () => {
    if (!input.trim() || sending) return;
    setSending(true);
    try {
      await api.sendText(agent.target, input);
      setInput("");
    } catch (e) {
      console.error("Send text failed:", e);
    } finally {
      setSending(false);
    }
  }, [agent.target, input, sending]);

  const handleKill = useCallback(async () => {
    try {
      await api.killAgent(agent.target);
    } catch (e) {
      console.error("Kill failed:", e);
    }
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

      {needsPermission && (
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

      {isIdle && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendText();
          }}
          className="flex gap-1.5"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type response..."
            className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-cyan-500/30 focus:outline-none"
            autoFocus
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="rounded-md bg-cyan-500/20 px-3 py-1 text-xs font-medium text-cyan-400 transition-colors hover:bg-cyan-500/30 disabled:opacity-50"
          >
            Send
          </button>
        </form>
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
