import { useMemo } from "react";
import { groupByProject, type AgentSnapshot, type Selection } from "@/lib/api";
import { ProjectGroup } from "@/components/project/ProjectGroup";

interface AgentListProps {
  agents: AgentSnapshot[];
  loading: boolean;
  selection: Selection | null;
  onSelectAgent: (target: string) => void;
  onSelectProject: (path: string, name: string) => void;
  registeredProjects: string[];
  onSpawned: (sessionId: string) => void;
}

// Scrollable list of agents grouped by project and worktree
export function AgentList({
  agents,
  loading,
  selection,
  onSelectAgent,
  onSelectProject,
  registeredProjects,
  onSpawned,
}: AgentListProps) {
  const projects = useMemo(
    () => groupByProject(agents, registeredProjects),
    [agents, registeredProjects],
  );

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
        Initializing...
      </div>
    );
  }

  if (agents.length === 0 && registeredProjects.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center text-sm text-zinc-500">
        <p>No projects registered</p>
        <p className="text-xs text-zinc-600">
          Add projects in{" "}
          <code className="rounded bg-white/5 px-1">config.toml</code> or run{" "}
          <code className="rounded bg-white/5 px-1">tmai init</code>
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
          selection={selection}
          onSelectAgent={onSelectAgent}
          onSelectProject={onSelectProject}
          onSpawned={onSpawned}
        />
      ))}
    </div>
  );
}
