import {
  type AgentAttention,
  type AgentSnapshot,
  type AgentType,
  type ConnectionChannels,
  type DetectionSource,
  isAiAgent,
  type SendCapability,
} from "@/lib/api";
import { cn } from "@/lib/utils";

// Decision tmai-core@2026-05-09 Phase 4: pill is driven by a flat
// attention enum (`"started" | "halted" | "completed"`) plus `null`
// for "running normally — no UI signal needed". The legacy `Active` /
// `Wait` / `Bootstrap` pills retired with the simplified wire shape.
//
// Per dogfood feedback (2026-05-10): the empty-pill rendering for `null`
// felt off, so we still surface a muted "Running" chip there. It is
// intentionally low-contrast so it reads as ambient status, not as
// something the user has to react to.
//
// Caveat for the "Running" label: right after a tmai-core restart that
// adopts live dispatches from the supervisor, every agent comes back
// with `attention = null` until the next hook fires. In that brief
// window the label may say "Running" even for an agent that is actually
// idle (waiting on a previous turn's user input). The next hook
// auto-corrects.
function attentionPill(state: AgentAttention | null): {
  label: string;
  style: string;
} {
  if (state === "started") {
    return {
      // Cyan = "engaging — agent just spawned, awaiting first prompt".
      // Reuses the visual the legacy "Bootstrap" pill carried.
      label: "Started",
      style: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
    };
  }
  if (state === "halted") {
    return {
      label: "Halted",
      style: "bg-rose-500/20 text-rose-300 border-rose-500/30",
    };
  }
  if (state === "completed") {
    return {
      label: "Done",
      style: "bg-sky-500/20 text-sky-300 border-sky-500/30",
    };
  }
  // null — agent is running, no user action needed. Muted styling so
  // the ambient state does not compete with the three blocking pills.
  return {
    label: "Running",
    style: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
  };
}

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
  // Decision tmai-core@2026-05-09 Phase 4: the wire enum collapses the
  // dynamic state to four values. Three flag user-blocked states (each
  // with its own pill); `null`/absent renders a muted "Running" chip
  // (dogfood feedback 2026-05-10 — ambient state still wants a marker).
  const attention = agent.attention ?? null;
  const hasAttention = attention !== null;
  const typeInfo = agentTypeLabel(agent.agent_type);
  const isAi = isAiAgent(agent.agent_type);

  // Pill info: every agent gets one. Muted "Running" for null.
  const attentionPillInfo = attentionPill(attention);
  const displayName = attentionPillInfo.label;
  const statusStyle = attentionPillInfo.style;
  // Halted keeps the existing red accent; other reasons rely on the
  // outer card's amber-glow-pulse to convey "needs attention".
  const glow = attention === "halted" ? "glow-red" : "";

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

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "glass-card group w-full rounded-xl px-3 py-2 text-left transition-subtle",
        "hover:bg-white/[0.08] hover:border-white/10",
        agent.is_orchestrator && "!border-cyan-500/20 bg-cyan-500/[0.04]",
        selected && "!border-cyan-500/30 !bg-cyan-500/10",
        hasAttention && "!border-amber-500/30 animate-glow-pulse",
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
