import { cn } from "@/lib/utils";
import { statusName, needsAttention, type AgentSnapshot } from "@/lib/api";

// Status badge color mapping
const statusColors: Record<string, string> = {
  Processing: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  AwaitingApproval: "bg-red-500/20 text-red-400 border-red-500/30",
  Idle: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
  Error: "bg-red-500/20 text-red-300 border-red-500/30",
  Offline: "bg-zinc-500/20 text-zinc-600 border-zinc-500/30",
  Unknown: "bg-zinc-500/20 text-zinc-500 border-zinc-500/30",
};

// Detection source icons (matching TUI)
const sourceIcons: Record<string, string> = {
  HttpHook: "◈",
  IpcSocket: "◉",
  CapturePane: "○",
};

interface AgentCardProps {
  agent: AgentSnapshot;
  selected?: boolean;
  onClick?: () => void;
}

// Card displaying a single agent's status and info
export function AgentCard({ agent, selected, onClick }: AgentCardProps) {
  const name = statusName(agent.status);
  const statusStyle = statusColors[name] ?? statusColors.Unknown;
  const sourceIcon = sourceIcons[agent.detection_source] ?? "?";
  const attention = needsAttention(agent.status);

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full rounded-lg border p-3 text-left transition-colors",
        "hover:bg-zinc-800/50",
        selected
          ? "border-zinc-500 bg-zinc-800/80"
          : "border-zinc-800 bg-zinc-900/50",
        attention && "border-amber-500/40",
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 truncate">
          <span className="text-xs text-zinc-500" title={agent.detection_source}>
            {sourceIcon}
          </span>
          <span className="truncate font-medium text-zinc-200">
            {agent.display_name}
          </span>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-md border px-1.5 py-0.5 text-xs font-medium",
            statusStyle,
          )}
        >
          {name}
        </span>
      </div>

      <div className="mt-1.5 flex items-center gap-2 text-xs text-zinc-500">
        <span className="truncate" title={agent.cwd}>
          {agent.display_cwd}
        </span>
        {agent.git_branch && (
          <span className="shrink-0 text-zinc-600">
            {agent.git_branch}
            {agent.git_dirty && "*"}
          </span>
        )}
      </div>

      {(agent.active_subagents > 0 || agent.compaction_count > 0) && (
        <div className="mt-1 flex gap-2 text-xs text-zinc-600">
          {agent.active_subagents > 0 && (
            <span>⑂{agent.active_subagents}</span>
          )}
          {agent.compaction_count > 0 && (
            <span>♻{agent.compaction_count}</span>
          )}
        </div>
      )}
    </button>
  );
}
