import type { AgentSnapshot } from "@/lib/api";
import { AgentCard } from "./AgentCard";

interface AgentListProps {
  agents: AgentSnapshot[];
  loading: boolean;
  selectedTarget: string | null;
  onSelect: (target: string) => void;
}

// Scrollable list of agent cards
export function AgentList({
  agents,
  loading,
  selectedTarget,
  onSelect,
}: AgentListProps) {
  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
        Initializing...
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center text-sm text-zinc-500">
        <p>No agents detected</p>
        <p className="text-xs text-zinc-600">
          Spawn an agent below or run{" "}
          <code className="rounded bg-zinc-800 px-1">tmai init</code> to enable
          hooks
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto p-2">
      {agents.map((agent) => (
        <AgentCard
          key={agent.target}
          agent={agent}
          selected={agent.target === selectedTarget}
          onClick={() => onSelect(agent.target)}
        />
      ))}
    </div>
  );
}
