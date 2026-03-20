import { useState } from "react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import type { ProjectGroup as ProjectGroupType, WorktreeGroup } from "@/lib/api";
import { AgentCard } from "@/components/agent/AgentCard";

interface ProjectGroupProps {
  project: ProjectGroupType;
  selectedTarget: string | null;
  onSelect: (target: string) => void;
  onSpawned: (sessionId: string) => void;
}

// Collapsible project group containing worktree sub-groups
export function ProjectGroup({
  project,
  selectedTarget,
  onSelect,
  onSpawned,
}: ProjectGroupProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [showSpawn, setShowSpawn] = useState(false);
  const [spawning, setSpawning] = useState(false);

  // Spawn an agent in this project's directory
  const spawn = async (command: string) => {
    if (spawning) return;
    setSpawning(true);
    setShowSpawn(false);
    try {
      const res = await api.spawnPty({ command, cwd: project.path });
      onSpawned(res.session_id);
    } catch (e) {
      console.error("Spawn failed:", e);
    } finally {
      setSpawning(false);
    }
  };

  const isEmpty = project.totalAgents === 0;

  return (
    <div className="mb-1">
      {/* Project header */}
      <div className="flex w-full items-center gap-1 rounded-lg px-2 py-1.5 transition-colors hover:bg-white/5">
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="flex flex-1 items-center gap-2 text-left"
        >
          <span
            className={cn(
              "text-[10px] text-zinc-600 transition-transform",
              collapsed && "-rotate-90",
            )}
          >
            ▼
          </span>
          <span
            className={cn(
              "truncate text-xs font-semibold",
              isEmpty ? "text-zinc-500" : "text-zinc-300",
            )}
          >
            {project.name}
          </span>
        </button>
        <div className="flex items-center gap-1.5">
          {project.totalAgents > 0 && (
            <span className="text-[10px] text-zinc-600">
              {project.totalAgents}
            </span>
          )}
          {project.attentionAgents > 0 && (
            <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-400">
              {project.attentionAgents}
            </span>
          )}
          {/* Spawn button */}
          <div className="relative">
            <button
              onClick={() => setShowSpawn((v) => !v)}
              disabled={spawning}
              className="rounded px-1 py-0.5 text-xs text-zinc-500 transition-colors hover:bg-white/10 hover:text-cyan-400 disabled:opacity-50"
              title="Spawn agent"
            >
              +
            </button>
            {showSpawn && (
              <div className="glass absolute right-0 top-full z-10 mt-1 flex flex-col gap-0.5 rounded-lg border border-white/10 p-1 shadow-lg">
                {["claude", "codex", "bash"].map((cmd) => (
                  <button
                    key={cmd}
                    onClick={() => spawn(cmd)}
                    className="whitespace-nowrap rounded px-3 py-1 text-left text-xs text-zinc-300 transition-colors hover:bg-white/10 hover:text-cyan-400"
                  >
                    {cmd}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

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
          {isEmpty && (
            <div className="px-2 py-2 text-[11px] text-zinc-600">
              No agents — click + to spawn
            </div>
          )}
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
