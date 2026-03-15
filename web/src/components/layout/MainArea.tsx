import { useMemo } from "react";
import { useAgentsStore } from "../../stores/agents";
import { AgentCardGrid } from "../cards/AgentCardGrid";
import { AgentFullView } from "../agent-view/AgentFullView";

export function MainArea() {
  const agents = useAgentsStore((s) => s.agents);
  const selectedProject = useAgentsStore((s) => s.selectedProject);
  const selectedAgentId = useAgentsStore((s) => s.selectedAgentId);

  const selectedAgent = useMemo(
    () => agents.find((a) => a.id === selectedAgentId) ?? null,
    [agents, selectedAgentId],
  );

  // Filter agents for the selected project
  const projectAgents = useMemo(() => {
    if (!selectedProject) return agents;
    return agents.filter(
      (a) => (a.git_common_dir ?? a.cwd) === selectedProject,
    );
  }, [agents, selectedProject]);

  // If an agent is selected, show full view
  if (selectedAgent) {
    return (
      <main className="flex-1 overflow-y-auto p-4">
        <AgentFullView agent={selectedAgent} />
      </main>
    );
  }

  // Otherwise show card grid
  return (
    <main className="flex-1 overflow-y-auto p-4">
      {agents.length === 0 ? (
        <div className="flex h-full items-center justify-center text-neutral-500">
          <p>No agents detected. Start agents to see them here.</p>
        </div>
      ) : (
        <AgentCardGrid agents={projectAgents} />
      )}
    </main>
  );
}
