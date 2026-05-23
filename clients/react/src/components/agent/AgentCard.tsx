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
      style: "bg-primary/20 text-primary border-primary/30",
    };
  }
  if (state === "halted") {
    return {
      label: "Halted",
      style: "bg-destructive/20 text-destructive border-destructive/30",
    };
  }
  if (state === "completed") {
    return {
      label: "Done",
      style: "bg-info/20 text-info border-info/30",
    };
  }
  // null — agent is running, no user action needed. Muted styling so
  // the ambient state does not compete with the three blocking pills.
  return {
    label: "Running",
    style: "bg-muted-foreground/10 text-muted-foreground border-hairline-strong/20",
  };
}

// Status-dot colour for the subordinate worker rows of the Producer-rooted
// roster (DR `2026-05-23-producer-rooted-left-panel.md`). This is the
// roster's *own* mapping — deliberately NOT the `attentionPill` palette: a
// worker row is a status glance, not a blocking-pill, so only `halted`
// gets the alarming destructive colour; `started`/`completed` read as muted
// transients; `null` ("running normally") gets the calm primary dot.
function attentionDotClass(state: AgentAttention | null): string {
  if (state === "halted") return "bg-destructive";
  if (state === "started" || state === "completed") return "bg-muted-foreground";
  return "bg-primary";
}

// Agent type display: short label + color
function agentTypeLabel(agentType: AgentType): {
  icon: string;
  label: string;
  color: string;
} {
  if (agentType === "ClaudeCode") return { icon: "⬡", label: "Claude", color: "text-warning" };
  if (agentType === "CodexCli") return { icon: "◆", label: "Codex", color: "text-success" };
  if (agentType === "GeminiCli") return { icon: "✦", label: "Gemini", color: "text-info" };
  if (agentType === "OpenCode") return { icon: "◇", label: "OpenCode", color: "text-accent" };
  if (typeof agentType === "object" && "Custom" in agentType)
    return { icon: "›", label: agentType.Custom, color: "text-muted-foreground" };
  return { icon: "›", label: "agent", color: "text-muted-foreground" };
}

// Model tier styling: color gradient per model family
function modelStyle(displayName: string): { color: string; glow: string } {
  const lower = displayName.toLowerCase();
  if (lower.includes("opus"))
    return { color: "text-warning/80", glow: "drop-shadow-[0_0_3px_rgba(251,191,36,0.3)]" };
  if (lower.includes("sonnet"))
    return { color: "text-accent/80", glow: "drop-shadow-[0_0_3px_rgba(167,139,250,0.2)]" };
  if (lower.includes("haiku")) return { color: "text-success/70", glow: "" };
  return { color: "text-muted-foreground", glow: "" };
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
        active
          ? `${activeColor} border border-current/20`
          : "text-subtle-foreground border border-hairline-strong",
      )}
    >
      {label}
    </span>
  );
}

// Visual treatment within the Producer-rooted roster (DR
// `2026-05-23-producer-rooted-left-panel.md`):
//   • "headline"  — the unit's single live Producer. First-class, "who am
//     I talking to" legible (PRODUCER badge + accent). Full card.
//   • "worker"    — a subordinate worker row of the Producer's roster.
//     Status-oriented + visually muted/smaller (status dot + branch/task).
//     Still click-selectable: the emergency direct-worker path §A keeps.
//   • "default"   — flat card with no Producer relationship asserted; used
//     by the honest degradation path when no single Producer resolves.
type AgentCardVariant = "headline" | "worker" | "default";

interface AgentCardProps {
  agent: AgentSnapshot;
  selected?: boolean;
  onClick?: () => void;
  variant?: AgentCardVariant;
}

// Card displaying a single agent's status and info
export function AgentCard({ agent, selected, onClick, variant = "default" }: AgentCardProps) {
  // Decision tmai-core@2026-05-09 Phase 4: the wire enum collapses the
  // dynamic state to four values. Three flag user-blocked states (each
  // with its own pill); `null`/absent renders a muted "Running" chip
  // (dogfood feedback 2026-05-10 — ambient state still wants a marker).
  const attention = agent.attention ?? null;
  const hasAttention = attention !== null;
  const typeInfo = agentTypeLabel(agent.agent_type);
  const isAi = isAiAgent(agent.agent_type);

  // Subordinate worker row of the Producer's roster. Deliberately a thin
  // status glance — status dot + branch/task label — NOT a second copy of
  // the right attention strip (role split, DR §役割分担). The row stays a
  // real <button> so the emergency direct-worker path (§A) survives.
  if (variant === "worker") {
    const taskLabel =
      agent.git_branch ?? (isAi ? typeInfo.label : agent.display_name || typeInfo.label);
    const dotTitle = `${agent.git_branch ? `${agent.is_worktree ? "worktree: " : "branch: "}${agent.git_branch}` : agent.display_cwd} — ${attentionPill(attention).label}`;
    return (
      <button
        type="button"
        onClick={onClick}
        title={dotTitle}
        className={cn(
          "group flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left transition-subtle",
          "hover:bg-surface",
          selected && "bg-primary/10",
        )}
      >
        <span
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            attentionDotClass(attention),
            attention === "halted" && "animate-glow-pulse",
          )}
          aria-hidden
        />
        <span className="truncate text-xs text-subtle-foreground group-hover:text-foreground transition-subtle">
          {agent.is_worktree && "🌿"}
          {taskLabel}
          {agent.git_dirty && <span className="text-warning">*</span>}
        </span>
        <span className="flex-1" />
        {agent.compaction_count > 0 && (
          <span className="shrink-0 text-[10px] text-subtle-foreground">
            ♻{agent.compaction_count}
          </span>
        )}
      </button>
    );
  }

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
        "hover:bg-surface hover:border-hairline-strong",
        agent.is_orchestrator && "!border-primary/20 bg-primary/[0.04]",
        // Producer headline: accent the unit's "who am I talking to" row so
        // it reads as first-class above its subordinate worker roster.
        variant === "headline" && "!border-primary/25 bg-primary/[0.05]",
        selected && "!border-primary/30 !bg-primary/10",
        hasAttention && "!border-warning/30 animate-glow-pulse",
        glow && selected && glow,
      )}
    >
      {/* Row 1: Agent type + status badge */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 truncate">
          {variant === "headline" && (
            <span className="shrink-0 rounded border border-primary/30 bg-primary/10 px-1 py-px text-[9px] font-semibold uppercase tracking-wider text-primary">
              Producer
            </span>
          )}
          {agent.is_orchestrator && (
            <span className="shrink-0 rounded border border-primary/30 bg-primary/10 px-1 py-px text-[9px] font-semibold text-primary">
              ORCH
            </span>
          )}
          <span className="truncate text-sm font-medium text-foreground group-hover:text-foreground transition-subtle">
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
      <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground transition-subtle group-hover:text-muted-foreground">
        {isAi && (
          <div className="flex items-center gap-0.5" title={tooltip}>
            {(channels.has_hook || channels.has_websocket) && (
              <ChannelBadge
                label={channels.has_websocket ? "WS" : "Hook"}
                active={channels.has_hook || channels.has_websocket}
                activeColor="text-primary"
              />
            )}
            {(channels.has_ipc ||
              channels.has_hook ||
              channels.has_websocket ||
              channels.has_tmux) && (
              <ChannelBadge label="IPC" active={channels.has_ipc} activeColor="text-success" />
            )}
            {channels.has_tmux && (
              <ChannelBadge label="tmux" active={channels.has_tmux} activeColor="text-warning" />
            )}
            {channels.has_pty && <ChannelBadge label="PTY" active activeColor="text-accent" />}
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
              agent.is_worktree ? "text-success" : "text-subtle-foreground",
              "group-hover:text-muted-foreground transition-subtle",
            )}
            title={`${agent.is_worktree ? "worktree: " : "branch: "}${agent.git_branch}${agent.git_dirty ? " (dirty)" : ""}`}
          >
            {agent.is_worktree && "🌿"}
            {agent.git_branch}
            {agent.git_dirty && <span className="text-warning">*</span>}
          </span>
        ) : (
          <span
            className="truncate text-right text-subtle-foreground group-hover:text-muted-foreground transition-subtle"
            title={agent.cwd}
          >
            {agent.display_cwd}
          </span>
        )}
        {agent.active_subagents > 0 && (
          <span className="shrink-0 text-subtle-foreground group-hover:text-muted-foreground transition-subtle">
            ⑂{agent.active_subagents}
          </span>
        )}
        {agent.compaction_count > 0 && (
          <span className="shrink-0 text-subtle-foreground group-hover:text-muted-foreground transition-subtle">
            ♻{agent.compaction_count}
          </span>
        )}
      </div>
    </button>
  );
}
