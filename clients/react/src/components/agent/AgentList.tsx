import { useMemo } from "react";
import { NewAgentLauncher } from "@/components/project/NewAgentLauncher";
import { ProjectGroup } from "@/components/project/ProjectGroup";
import {
  type AgentSnapshot,
  groupByProject,
  type Selection,
  type WorktreeSnapshot,
} from "@/lib/api";

interface AgentListProps {
  agents: AgentSnapshot[];
  loading: boolean;
  selection: Selection | null;
  onSelectAgent: (target: string) => void;
  onSelectProject: (path: string, name: string) => void;
  onSelectMarkdown: (projectPath: string, projectName: string) => void;
  worktrees: WorktreeSnapshot[];
  onSpawned: (sessionId: string) => void;
  splitPaneProjectPath: string | null;
  splitPaneTab: "git" | "markdown" | null;
}

// Scrollable list of agents grouped by project and worktree
export function AgentList({
  agents,
  loading,
  selection,
  onSelectAgent,
  onSelectProject,
  onSelectMarkdown,
  worktrees,
  onSpawned,
  splitPaneProjectPath,
  splitPaneTab,
}: AgentListProps) {
  const projects = useMemo(() => groupByProject(agents, worktrees), [agents, worktrees]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
        Initializing...
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto p-2">
      <NewAgentLauncher onSpawned={onSpawned} />
      {projects.length === 0 ? (
        <p className="px-2 py-6 text-center text-xs text-zinc-600">
          No agents — pick a directory above to spawn one.
        </p>
      ) : (
        projects.map((project) => (
          <ProjectGroup
            key={project.path}
            project={project}
            selection={selection}
            onSelectAgent={onSelectAgent}
            onSelectProject={onSelectProject}
            onSelectMarkdown={onSelectMarkdown}
            onSpawned={onSpawned}
            splitPaneProjectPath={splitPaneProjectPath}
            splitPaneTab={splitPaneTab}
          />
        ))
      )}
    </div>
  );
}
