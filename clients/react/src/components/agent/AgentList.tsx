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
      {/* Phase B of the Producer-console rebuild
          (`doc/decisions/2026-05-14-react-producer-console-rebuild.md`)
          moved the main flow to the Producer console (the empty
          main-pane view). This sidebar still exists — defaults to
          collapsed, opt-in via the Operator override panel or the
          sidebar toggle — so the operator has a direct-agent
          escape hatch. The label below makes that intent visible. */}
      <div className="mb-2 border-b border-white/5 pb-2">
        <p className="text-[11px] uppercase tracking-wider text-amber-400/70">
          Operator view (legacy)
        </p>
        <p className="mt-0.5 text-[10px] leading-tight text-zinc-600">
          Direct agent / project access. The new main flow is the Producer console — use this
          sidebar only when you need to bypass the Producer.
        </p>
      </div>
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
