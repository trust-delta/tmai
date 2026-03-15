import { useAgentsStore } from "../../stores/agents";
import { statusColor } from "../../lib/formatStatus";
import type { Agent } from "../../types/agent";

interface AgentTreeItemProps {
  agent: Agent;
}

export function AgentTreeItem({ agent }: AgentTreeItemProps) {
  const selectedAgentId = useAgentsStore((s) => s.selectedAgentId);
  const selectAgent = useAgentsStore((s) => s.selectAgent);

  const isSelected = selectedAgentId === agent.id;
  const color = statusColor(agent.status);

  return (
    <button
      onClick={() => selectAgent(agent.id)}
      className={`flex w-full items-center gap-1.5 px-3 py-1 text-left text-xs hover:bg-neutral-200 dark:hover:bg-neutral-800 ${
        isSelected ? "bg-neutral-300 dark:bg-neutral-700" : ""
      }`}
    >
      <span className={`text-[10px] ${color}`}>●</span>
      <span className="flex-1 truncate">{agent.agent_type}</span>
      {agent.git_branch && (
        <span className="truncate text-[10px] text-neutral-500">
          {agent.git_branch}
        </span>
      )}
      {agent.needs_attention && (
        <span className="text-yellow-400 text-[10px]">!</span>
      )}
    </button>
  );
}
