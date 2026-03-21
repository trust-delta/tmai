import { cn } from "@/lib/utils";
import {
  statusName,
  needsAttention,
  isAiAgent,
  api,
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

const sendIcons: Record<string, string> = {
  Ipc: "⇋",
  Tmux: "⇉",
  PtyInject: "⇝",
  None: "⊘",
};

/// Resolve effective auto-approve state: override > global
function autoApproveEffective(agent: AgentSnapshot): boolean {
  if (agent.auto_approve_override !== null && agent.auto_approve_override !== undefined) {
    return agent.auto_approve_override;
  }
  // No override — assume global default (we don't have global state here,
  // but the badge only shows when override is explicitly set)
  return true;
}

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
  const sendIcon = sendIcons[agent.send_capability] ?? "?";
  const canSend = agent.send_capability !== "None";

  // Auto-approve state
  const hasOverride = agent.auto_approve_override !== null && agent.auto_approve_override !== undefined;
  const isAutoApproveOn = autoApproveEffective(agent);

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

  /// Toggle auto-approve override: null → true → false → null (cycle)
  function handleAutoApproveToggle(e: React.MouseEvent) {
    e.stopPropagation();
    let next: boolean | null;
    if (agent.auto_approve_override === null || agent.auto_approve_override === undefined) {
      next = false; // global → force off
    } else if (agent.auto_approve_override === false) {
      next = true; // force off → force on
    } else {
      next = null; // force on → back to global
    }
    api.setAutoApprove(agent.target, next);
  }

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
              title={`detect: ${agent.detection_source} | send: ${agent.send_capability}`}
            >
              {sourceIcon}
              <span className={canSend ? "" : "text-red-500"}>{sendIcon}</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* Auto-approve toggle */}
          <span
            onClick={handleAutoApproveToggle}
            className={cn(
              "shrink-0 cursor-pointer rounded px-1 py-0.5 text-[10px] transition-colors",
              !hasOverride && "text-zinc-600 hover:text-zinc-400",
              hasOverride && isAutoApproveOn && "text-emerald-400 bg-emerald-500/10",
              hasOverride && !isAutoApproveOn && "text-red-400 bg-red-500/10",
            )}
            title={
              !hasOverride
                ? "Auto-approve: global default (click to override)"
                : isAutoApproveOn
                  ? "Auto-approve: ON (click to cycle)"
                  : "Auto-approve: OFF (click to cycle)"
            }
          >
            {!hasOverride ? "⚡" : isAutoApproveOn ? "⚡on" : "⚡off"}
          </span>
          <span
            className={cn(
              "shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
              statusStyle,
            )}
          >
            {displayName}
          </span>
        </div>
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
