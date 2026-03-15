import { useAgentsStore } from "../../stores/agents";
import { StatusBadge } from "../common/StatusBadge";
import { statusLabel } from "../../lib/formatStatus";
import type { Agent } from "../../types/agent";

interface AgentCardProps {
  agent: Agent;
}

export function AgentCard({ agent }: AgentCardProps) {
  const selectAgent = useAgentsStore((s) => s.selectAgent);

  return (
    <button
      onClick={() => selectAgent(agent.id)}
      className={`flex flex-col gap-2 rounded-lg border p-4 text-left transition-colors hover:border-neutral-400 dark:hover:border-neutral-600 ${
        agent.needs_attention
          ? "border-yellow-400 dark:border-yellow-700"
          : "border-neutral-200 dark:border-neutral-800"
      } bg-neutral-50 dark:bg-neutral-900`}
    >
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-medium">
            {agent.agent_type}
          </span>
          {agent.is_virtual && (
            <span className="text-[10px] text-neutral-500">virtual</span>
          )}
        </div>
        <StatusBadge status={agent.status} />
      </div>

      {/* Git info */}
      {agent.git_branch && (
        <div className="flex items-center gap-1.5 text-xs text-neutral-400">
          <span className="font-mono">{agent.git_branch}</span>
          {agent.git_dirty && <span className="text-yellow-500">*</span>}
          {agent.is_worktree && (
            <span className="text-cyan-500" title="worktree">
              wt
            </span>
          )}
        </div>
      )}

      {/* Team info */}
      {agent.team && (
        <div className="text-xs text-neutral-500">
          <span>{agent.team.team_name}</span>
          <span className="mx-1">·</span>
          <span>{agent.team.member_name}</span>
        </div>
      )}

      {/* Status details */}
      {agent.status.type === "awaiting_approval" && (
        <div className="mt-1 truncate text-xs text-yellow-600 dark:text-yellow-300">
          {agent.status.details}
        </div>
      )}
      {agent.status.type === "processing" && agent.status.message && (
        <div className="mt-1 truncate text-xs text-blue-600 dark:text-blue-300">
          {statusLabel(agent.status)}
        </div>
      )}

      {/* CWD */}
      <div
        className="truncate text-[11px] text-neutral-400 dark:text-neutral-600"
        title={agent.cwd}
      >
        {agent.cwd}
      </div>
    </button>
  );
}
