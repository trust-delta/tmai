import { useState } from "react";
import { cn } from "@/lib/utils";
import type {
  ProjectGroup as ProjectGroupType,
  WorktreeGroup,
} from "@/lib/api";
import { AgentCard } from "@/components/agent/AgentCard";

interface ProjectGroupProps {
  project: ProjectGroupType;
  selectedTarget: string | null;
  onSelect: (target: string) => void;
}

// Collapsible project group containing worktree sub-groups
export function ProjectGroup({
  project,
  selectedTarget,
  onSelect,
}: ProjectGroupProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="mb-1">
      {/* Project header */}
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/5"
      >
        <span
          className={cn(
            "text-[10px] text-zinc-600 transition-transform",
            collapsed && "-rotate-90",
          )}
        >
          ▼
        </span>
        <span className="truncate text-xs font-semibold text-zinc-300">
          {project.name}
        </span>
        <div className="flex-1" />
        <span className="text-[10px] text-zinc-600">
          {project.totalAgents}
        </span>
        {project.attentionAgents > 0 && (
          <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-400">
            {project.attentionAgents}
          </span>
        )}
      </button>

      {/* Worktree sub-groups */}
      {!collapsed && (
        <div className="ml-1 border-l border-white/5 pl-2">
          {project.worktrees.map((wt) => (
            <WorktreeSection
              key={wt.name}
              worktree={wt}
              selectedTarget={selectedTarget}
              onSelect={onSelect}
              showHeader={project.worktrees.length > 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface WorktreeSectionProps {
  worktree: WorktreeGroup;
  selectedTarget: string | null;
  onSelect: (target: string) => void;
  showHeader: boolean;
}

// Sub-section for a worktree (or main) within a project
function WorktreeSection({
  worktree,
  selectedTarget,
  onSelect,
  showHeader,
}: WorktreeSectionProps) {
  return (
    <div className="mb-0.5">
      {showHeader && (
        <div className="flex items-center gap-1.5 px-1 py-1">
          {worktree.isWorktree ? (
            <span className="text-[10px] text-emerald-500">🌿</span>
          ) : (
            <span className="text-[10px] text-zinc-500">●</span>
          )}
          <span className="truncate text-[11px] text-zinc-500">
            {worktree.branch || worktree.name}
          </span>
          {worktree.dirty && (
            <span className="text-[10px] text-amber-500">*</span>
          )}
        </div>
      )}
      <div className="flex flex-col gap-1">
        {worktree.agents.map((agent) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            selected={agent.id === selectedTarget}
            onClick={() => onSelect(agent.id)}
          />
        ))}
      </div>
    </div>
  );
}
