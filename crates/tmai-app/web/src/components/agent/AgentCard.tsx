import {
  type AgentSnapshot,
  type AgentType,
  api,
  type ConnectionChannels,
  type DetectionSource,
  isAiAgent,
  needsAttention,
  type SendCapability,
  statusName,
} from "@/lib/api";
import { cn } from "@/lib/utils";

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
  if (agentType === "ClaudeCode") return { icon: "⬡", label: "Claude", color: "text-orange-400" };
  if (agentType === "CodexCli") return { icon: "◆", label: "Codex", color: "text-green-400" };
  if (agentType === "GeminiCli") return { icon: "✦", label: "Gemini", color: "text-blue-400" };
  if (agentType === "OpenCode") return { icon: "◇", label: "OpenCode", color: "text-purple-400" };
  if (typeof agentType === "object" && "Custom" in agentType)
    return { icon: "›", label: agentType.Custom, color: "text-zinc-400" };
  return { icon: "›", label: "agent", color: "text-zinc-400" };
}

// Model tier styling: color gradient per model family
function modelStyle(displayName: string): { color: string; glow: string } {
  const lower = displayName.toLowerCase();
  if (lower.includes("opus"))
    return { color: "text-amber-400/80", glow: "drop-shadow-[0_0_3px_rgba(251,191,36,0.3)]" };
  if (lower.includes("sonnet"))
    return { color: "text-violet-400/80", glow: "drop-shadow-[0_0_3px_rgba(167,139,250,0.2)]" };
  if (lower.includes("haiku")) return { color: "text-emerald-400/70", glow: "" };
  return { color: "text-zinc-500", glow: "" };
}

// Build tooltip describing detection and send details
function buildConnectionTooltip(
  channels: ConnectionChannels,
  detectionSource: DetectionSource,
  sendCapability: SendCapability,
): string {
  const detectMethods: string[] = [];
  if (channels.has_hook) detectMethods.push("Hook");
  if (channels.has_websocket) detectMethods.push("WebSocket");
  if (channels.has_ipc) detectMethods.push("IPC");
  if (channels.has_tmux) detectMethods.push("tmux");
  if (channels.has_pty) detectMethods.push("PTY");
  if (detectMethods.length === 0) detectMethods.push("None");

  const sendLabels: Record<string, string> = {
    Ipc: "IPC",
    Tmux: "tmux",
    PtyInject: "PTY inject",
    None: "None",
  };
  const sendLabel = sendLabels[sendCapability] ?? sendCapability;

  const activeLabels: Record<DetectionSource, string> = {
    HttpHook: "Hook",
    IpcSocket: "IPC",
    WebSocket: "WebSocket",
    CapturePane: channels.has_pty ? "PTY" : "tmux",
  };
  const activeLabel = activeLabels[detectionSource] ?? detectionSource;

  return `Detect: ${detectMethods.join(" + ")} (active: ${activeLabel})\nSend: ${sendLabel}`;
}

/// Resolve effective auto-approve state: override > global
function autoApproveEffective(agent: AgentSnapshot): boolean {
  if (agent.auto_approve_override !== null && agent.auto_approve_override !== undefined) {
    return agent.auto_approve_override;
  }
  // No override — assume global default (we don't have global state here,
  // but the badge only shows when override is explicitly set)
  return true;
}

// Channel badge: rounded pill with color when active, gray when inactive
function ChannelBadge({
  label,
  active,
  activeColor,
}: {
  label: string;
  active: boolean;
  activeColor: string;
}) {
  return (
    <span
      className={cn(
        "rounded-sm px-1 py-px text-[9px] font-medium leading-tight transition-subtle",
        active ? `${activeColor} border border-current/20` : "text-zinc-700 border border-zinc-800",
      )}
    >
      {label}
    </span>
  );
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
  // Auto-approve state
  const hasOverride =
    agent.auto_approve_override !== null && agent.auto_approve_override !== undefined;
  const isAutoApproveOn = autoApproveEffective(agent);

  // Auto-approve overrides status display when active
  const phase = agent.auto_approve_phase;
  const isJudging = phase === "Judging";
  const isAutoApproved = phase === "ApprovedByRule" || phase === "ApprovedByAi";
  const displayName = isJudging ? "Judging" : isAutoApproved ? "Approved" : name;
  const statusStyle = isJudging
    ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
    : isAutoApproved
      ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
      : (statusColors[name] ?? statusColors.Unknown);
  const glow = isJudging || isAutoApproved ? "" : (statusGlow[name] ?? "");

  // Connection channels (with fallback for older API)
  const channels: ConnectionChannels = agent.connection_channels ?? {
    has_tmux: agent.detection_source === "CapturePane" || agent.send_capability === "Tmux",
    has_ipc: agent.detection_source === "IpcSocket" || agent.send_capability === "Ipc",
    has_hook: agent.detection_source === "HttpHook",
    has_websocket: agent.detection_source === "WebSocket",
    has_pty: false,
  };

  const tooltip = isAi
    ? buildConnectionTooltip(channels, agent.detection_source, agent.send_capability)
    : undefined;

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
      type="button"
      onClick={onClick}
      className={cn(
        "glass-card group w-full rounded-xl px-3 py-2 text-left transition-subtle",
        "hover:bg-white/[0.08] hover:border-white/10",
        agent.is_orchestrator && "!border-cyan-500/20 bg-cyan-500/[0.04]",
        selected && "!border-cyan-500/30 !bg-cyan-500/10",
        attention && "!border-amber-500/30 animate-glow-pulse",
        glow && selected && glow,
      )}
    >
      {/* Row 1: Agent type + status badge */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 truncate">
          {agent.is_orchestrator && (
            <span className="shrink-0 rounded border border-cyan-500/30 bg-cyan-500/10 px-1 py-px text-[9px] font-semibold text-cyan-400">
              ORCH
            </span>
          )}
          <span className="truncate text-sm font-medium text-zinc-200 group-hover:text-zinc-100 transition-subtle">
            {isAi ? typeInfo.label : agent.display_name || typeInfo.label}
            {isAi && agent.model_display_name && (
              <span
                className={cn(
                  "ml-1.5 text-[10px] font-medium tracking-wide transition-subtle",
                  modelStyle(agent.model_display_name).color,
                  modelStyle(agent.model_display_name).glow,
                )}
              >
                {agent.model_display_name}
              </span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {/* Auto-approve toggle */}
          <button
            type="button"
            onClick={handleAutoApproveToggle}
            className={cn(
              "shrink-0 cursor-pointer rounded px-1 py-0.5 text-[10px] transition-subtle",
              !hasOverride && "text-zinc-600 hover:text-zinc-400 hover:bg-white/5",
              hasOverride &&
                isAutoApproveOn &&
                "text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/15",
              hasOverride && !isAutoApproveOn && "text-red-400 bg-red-500/10 hover:bg-red-500/15",
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
          </button>
          <span
            className={cn(
              "shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-medium transition-subtle",
              statusStyle,
            )}
          >
            {displayName}
          </span>
        </div>
      </div>

      {/* Row 2: connection channel badges + branch */}
      <div className="mt-1 flex items-center gap-1 text-xs text-zinc-500 transition-subtle group-hover:text-zinc-400">
        {isAi && (
          <div className="flex items-center gap-0.5" title={tooltip}>
            {(channels.has_hook || channels.has_websocket) && (
              <ChannelBadge
                label={channels.has_websocket ? "WS" : "Hook"}
                active={channels.has_hook || channels.has_websocket}
                activeColor="text-cyan-400"
              />
            )}
            {(channels.has_ipc ||
              channels.has_hook ||
              channels.has_websocket ||
              channels.has_tmux) && (
              <ChannelBadge label="IPC" active={channels.has_ipc} activeColor="text-emerald-400" />
            )}
            {channels.has_tmux && (
              <ChannelBadge label="tmux" active={channels.has_tmux} activeColor="text-yellow-400" />
            )}
            {channels.has_pty && <ChannelBadge label="PTY" active activeColor="text-violet-400" />}
            {/* Fallback: no known channel */}
            {!channels.has_hook &&
              !channels.has_websocket &&
              !channels.has_ipc &&
              !channels.has_tmux &&
              !channels.has_pty && <ChannelBadge label="--" active={false} activeColor="" />}
          </div>
        )}

        <div className="flex-1" />

        {/* Branch / worktree info (right side) */}
        {agent.git_branch ? (
          <span
            className={cn(
              "truncate text-right",
              agent.is_worktree ? "text-emerald-600" : "text-zinc-600",
              "group-hover:text-zinc-500 transition-subtle",
            )}
            title={`${agent.is_worktree ? "worktree: " : "branch: "}${agent.git_branch}${agent.git_dirty ? " (dirty)" : ""}`}
          >
            {agent.is_worktree && "🌿"}
            {agent.git_branch}
            {agent.git_dirty && <span className="text-amber-500">*</span>}
          </span>
        ) : (
          <span
            className="truncate text-right text-zinc-600 group-hover:text-zinc-500 transition-subtle"
            title={agent.cwd}
          >
            {agent.display_cwd}
          </span>
        )}
        {agent.active_subagents > 0 && (
          <span className="shrink-0 text-zinc-600 group-hover:text-zinc-400 transition-subtle">
            ⑂{agent.active_subagents}
          </span>
        )}
        {agent.compaction_count > 0 && (
          <span className="shrink-0 text-zinc-600 group-hover:text-zinc-400 transition-subtle">
            ♻{agent.compaction_count}
          </span>
        )}
      </div>
    </button>
  );
}
