import { cn } from "@/lib/utils";
import {
  statusName,
  needsAttention,
  isAiAgent,
  type AgentSnapshot,
  type AgentType,
} from "@/lib/api";

const statusColors: Record<string, string> = {
  Processing: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  AwaitingApproval: "bg-red-500/20 text-red-400 border-red-500/30",
  Idle: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
  Error: "bg-red-500/20 text-red-300 border-red-500/30",
  Offline: "bg-zinc-500/20 text-zinc-600 border-zinc-500/30",
  Unknown: "bg-zinc-500/20 text-zinc-500 border-zinc-500/30",
};

const statusGlow: Record<string, string> = {
  Processing: "glow-cyan",
  AwaitingApproval: "glow-red",
};

// Agent type display: short label + color
function agentTypeLabel(agentType: AgentType): {
  icon: string;
  label: string;
  color: string;
} {
  if (agentType === "ClaudeCode")
    return { icon: "⬡", label: "Claude", color: "text-orange-400" };
  if (agentType === "CodexCli")
    return { icon: "◆", label: "Codex", color: "text-green-400" };
  if (agentType === "GeminiCli")
    return { icon: "✦", label: "Gemini", color: "text-blue-400" };
  if (agentType === "OpenCode")
    return { icon: "◇", label: "OpenCode", color: "text-purple-400" };
  if (typeof agentType === "object" && "Custom" in agentType)
    return { icon: "›", label: agentType.Custom, color: "text-zinc-400" };
  return { icon: "›", label: "agent", color: "text-zinc-400" };
}

const sourceIcons: Record<string, string> = {
  HttpHook: "◈",
  IpcSocket: "◉",
  CapturePane: "○",
  WebSocket: "◇",
};

interface AgentCardProps {
  agent: AgentSnapshot;
  selected?: boolean;
  onClick?: () => void;
}

// Card displaying a single agent's status and info
export function AgentCard({ agent, selected, onClick }: AgentCardProps) {
  const name = statusName(agent.status);
  const attention = needsAttention(agent.status);
  const typeInfo = agentTypeLabel(agent.agent_type);
  const isAi = isAiAgent(agent.agent_type);
  const sourceIcon = sourceIcons[agent.detection_source] ?? "?";

  // Auto-approve overrides status display when active
  const phase = agent.auto_approve_phase;
  const isJudging = phase === "Judging";
  const isAutoApproved = phase === "ApprovedByRule" || phase === "ApprovedByAi";
  const displayName = isJudging
    ? "Judging"
    : isAutoApproved
      ? "Approved"
      : name;
  const statusStyle = isJudging
    ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
    : isAutoApproved
      ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
      : (statusColors[name] ?? statusColors.Unknown);
  const glow = isJudging || isAutoApproved ? "" : (statusGlow[name] ?? "");

  return (
    <button
      onClick={onClick}
      className={cn(
        "glass-card w-full rounded-xl px-3 py-2 text-left transition-all",
        selected && "!border-cyan-500/30 !bg-cyan-500/10",
        attention && "!border-amber-500/30",
        glow && selected && glow,
      )}
    >
      {/* Row 1: Agent type + status badge */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 truncate">
          <span className={cn("text-sm", typeInfo.color)}>{typeInfo.icon}</span>
          <span className="truncate text-sm font-medium text-zinc-200">
            {isAi ? typeInfo.label : agent.display_name || typeInfo.label}
          </span>
          {isAi && (
            <span
              className="text-[10px] text-zinc-600"
              title={agent.detection_source}
            >
              {sourceIcon}
            </span>
          )}
        </div>
        <span
          className={cn(
            "shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
            statusStyle,
          )}
        >
          {displayName}
        </span>
      </div>

      {/* Row 2: Branch + worktree + meta indicators */}
      <div className="mt-1 flex items-center gap-1.5 text-xs text-zinc-500">
        {agent.is_worktree && (
          <span className="text-emerald-500" title="worktree">
            🌿
          </span>
        )}
        {agent.git_branch && (
          <span className="truncate text-zinc-400">
            {agent.git_branch}
            {agent.git_dirty && (
              <span className="text-amber-500">*</span>
            )}
          </span>
        )}
        {!agent.git_branch && (
          <span className="truncate text-zinc-600" title={agent.cwd}>
            {agent.display_cwd}
          </span>
        )}
        <div className="flex-1" />
        {agent.active_subagents > 0 && (
          <span className="shrink-0 text-zinc-600">
            ⑂{agent.active_subagents}
          </span>
        )}
        {agent.compaction_count > 0 && (
          <span className="shrink-0 text-zinc-600">
            ♻{agent.compaction_count}
          </span>
        )}
      </div>
    </button>
  );
}
