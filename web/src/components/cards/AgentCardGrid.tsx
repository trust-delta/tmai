import type { Agent } from "../../types/agent";
import { AgentCard } from "./AgentCard";

interface AgentCardGridProps {
  agents: Agent[];
}

export function AgentCardGrid({ agents }: AgentCardGridProps) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {agents.map((agent) => (
        <AgentCard key={agent.id} agent={agent} />
      ))}
    </div>
  );
}
