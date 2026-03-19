import { useMemo } from "react";
import { groupByProject, type AgentSnapshot } from "@/lib/api";
import { ProjectGroup } from "@/components/project/ProjectGroup";

interface AgentListProps {
  agents: AgentSnapshot[];
  loading: boolean;
  selectedTarget: string | null;
  onSelect: (target: string) => void;
}

// Scrollable list of agents grouped by project and worktree
export function AgentList({
  agents,
  loading,
  selectedTarget,
  onSelect,
}: AgentListProps) {
  const projects = useMemo(() => groupByProject(agents), [agents]);

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
          <code className="rounded bg-white/5 px-1">tmai init</code> to enable
          hooks
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto p-2">
      {projects.map((project) => (
        <ProjectGroup
          key={project.path}
          project={project}
          selectedTarget={selectedTarget}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
