import { useCallback, useEffect, useRef, useState } from "react";
import { AgentCard } from "@/components/agent/AgentCard";
import { useConfirm } from "@/components/layout/ConfirmDialog";
import type { ProjectGroup as ProjectGroupType, Selection, WorktreeGroup } from "@/lib/api";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface ProjectGroupProps {
  project: ProjectGroupType;
  selection: Selection | null;
  onSelectAgent: (target: string) => void;
  onSelectProject: (path: string, name: string) => void;
  onSelectMarkdown: (projectPath: string, projectName: string) => void;
  onSpawned: (sessionId: string) => void;
}

// Collapsible project group containing worktree sub-groups
export function ProjectGroup({
  project,
  selection,
  onSelectAgent,
  onSelectProject,
  onSelectMarkdown,
  onSpawned,
}: ProjectGroupProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [showSpawn, setShowSpawn] = useState(false);
  const [spawning, setSpawning] = useState(false);
  const spawnRef = useRef<HTMLDivElement>(null);

  // Close spawn dropdown on outside click
  useEffect(() => {
    if (!showSpawn) return;
    const handleClick = (e: MouseEvent) => {
      if (spawnRef.current && !spawnRef.current.contains(e.target as Node)) {
        setShowSpawn(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showSpawn]);

  // Derive branch info from worktree groups
  const mainWt = project.worktrees.find((wt) => !wt.isWorktree);
  const mainBranch = mainWt?.branch ?? null;
  const mainDirty = mainWt?.dirty ?? false;
  const worktreeCount = project.worktrees.filter((wt) => wt.isWorktree).length;
  const worktreesDirty = project.worktrees.filter((wt) => wt.isWorktree).some((wt) => wt.dirty);

  // Derive selectedTarget for agent card highlighting
  const selectedTarget = selection?.type === "agent" ? selection.id : null;
  const isProjectSelected = selection?.type === "project" && selection.path === project.path;
  const isMarkdownSelected =
    selection?.type === "markdown" && selection.projectPath === project.path;

  // Spawn an agent in a specific directory
  const confirm = useConfirm();
  const spawn = useCallback(
    async (command: string, cwd: string, hasAgent: boolean, args?: string[]) => {
      if (spawning) return;
      if (hasAgent && command !== "bash") {
        const ok = await confirm({
          title: "Agent Active",
          message: `An agent is already active here. Launch ${command} anyway?`,
          confirmLabel: `Launch ${command}`,
          variant: "danger",
        });
        if (!ok) return;
      }
      setSpawning(true);
      setShowSpawn(false);
      try {
        const res = await api.spawnPty({ command, args, cwd });
        onSpawned(res.session_id);
      } catch (_e) {
      } finally {
        setSpawning(false);
      }
    },
    [spawning, confirm, onSpawned],
  );

  // All spawn targets: main + worktrees. Fallback ensures at least one target.
  const defaultTarget: WorktreeGroup = {
    name: "main",
    path: project.path,
    branch: null,
    isWorktree: false,
    dirty: false,
    agents: [],
  };
  const spawnTargets: WorktreeGroup[] =
    project.worktrees.length > 0 ? project.worktrees : [defaultTarget];
  const hasMultipleTargets =
    spawnTargets.length > 1 || (spawnTargets.length === 1 && spawnTargets[0].isWorktree);

  const isEmpty = project.totalAgents === 0;

  return (
    <div className="mb-1">
      {/* Project header */}
      <div className="flex w-full items-center gap-1 rounded-lg px-2 py-1.5 transition-colors hover:bg-white/5">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="flex flex-1 items-center gap-2 text-left min-w-0"
        >
          <span
            className={cn(
              "text-[10px] text-zinc-600 transition-transform shrink-0",
              collapsed && "-rotate-90",
            )}
          >
            ▼
          </span>
          <div className="min-w-0">
            <span
              className={cn(
                "block truncate text-xs font-semibold",
                isEmpty ? "text-zinc-500" : "text-zinc-300",
              )}
            >
              {project.name}
            </span>
            {/* Branch info under project name */}
            <div className="flex items-center gap-1.5 mt-0.5">
              {mainBranch && (
                <span className="truncate text-[10px] text-zinc-500">
                  {mainBranch}
                  {mainDirty && <span className="text-amber-500">*</span>}
                </span>
              )}
              {worktreeCount > 0 && (
                <span className="flex items-center gap-0.5 text-[10px] text-emerald-600">
                  <span>🌿</span>
                  <span>×{worktreeCount}</span>
                  {worktreesDirty && <span className="text-amber-500">*</span>}
                </span>
              )}
            </div>
          </div>
        </button>
        <div className="flex items-center gap-1.5">
          {project.totalAgents > 0 && (
            <span className="text-[10px] text-zinc-600">{project.totalAgents}</span>
          )}
          {project.attentionAgents > 0 && (
            <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-400">
              {project.attentionAgents}
            </span>
          )}
          {/* Branch graph button */}
          <button
            type="button"
            onClick={() => onSelectProject(project.path, project.name)}
            className={cn(
              "rounded px-1 py-0.5 transition-colors",
              isProjectSelected
                ? "text-emerald-400 bg-emerald-500/10"
                : "text-zinc-600 hover:text-emerald-400 hover:bg-emerald-500/10",
            )}
            title="Branch graph"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              className="inline-block"
              role="img"
              aria-label="Branch graph"
            >
              <title>Branch graph</title>
              <circle cx="4" cy="4" r="2" fill="currentColor" />
              <circle cx="4" cy="12" r="2" fill="currentColor" />
              <circle cx="12" cy="8" r="2" fill="currentColor" />
              <line x1="4" y1="6" x2="4" y2="10" stroke="currentColor" strokeWidth="1.5" />
              <path d="M4 6 C4 8, 8 8, 12 8" stroke="currentColor" strokeWidth="1.5" fill="none" />
            </svg>
          </button>
          {/* Markdown files button */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSelectMarkdown(project.path, project.name);
            }}
            className={cn(
              "rounded px-1 py-0.5 transition-colors",
              isMarkdownSelected
                ? "text-blue-400 bg-blue-500/10"
                : "text-zinc-600 hover:text-blue-400 hover:bg-blue-500/10",
            )}
            title="Markdown files"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              className="inline-block"
              role="img"
              aria-label="Markdown files"
            >
              <title>Markdown files</title>
              <rect
                x="2"
                y="1"
                width="12"
                height="14"
                rx="1"
                stroke="currentColor"
                strokeWidth="1.5"
                fill="none"
              />
              <text
                x="8"
                y="11"
                textAnchor="middle"
                fill="currentColor"
                fontSize="7"
                fontWeight="bold"
              >
                M
              </text>
            </svg>
          </button>
          {/* Spawn button */}
          <div className="relative" ref={spawnRef}>
            <button
              type="button"
              onClick={() => setShowSpawn((v) => !v)}
              disabled={spawning}
              className="rounded px-1 py-0.5 text-xs text-zinc-500 transition-colors hover:bg-white/10 hover:text-cyan-400 disabled:opacity-50"
              title="Spawn agent"
            >
              +
            </button>
            {showSpawn && (
              <div className="absolute right-0 top-full z-10 mt-1 flex flex-col gap-0.5 rounded-lg border border-white/10 bg-zinc-900 p-1 shadow-lg min-w-[140px]">
                {hasMultipleTargets
                  ? // Show worktree-grouped spawn options
                    spawnTargets.map((target) => {
                      const hasAgent = target.agents.length > 0;
                      return (
                        <div key={target.name}>
                          <div className="px-2 py-0.5 text-[10px] text-zinc-500 truncate">
                            {target.isWorktree ? "🌿 " : ""}
                            {target.branch || target.name}
                            {hasAgent && (
                              <span className="ml-1 text-amber-500" title="Agent active">
                                ●
                              </span>
                            )}
                          </div>
                          <div className="flex gap-0.5 px-1 pb-0.5">
                            {["claude", "codex", "bash"].map((cmd) => (
                              <button
                                type="button"
                                key={`${target.name}-${cmd}`}
                                onClick={() => spawn(cmd, target.path, hasAgent)}
                                className="flex-1 whitespace-nowrap rounded px-2 py-0.5 text-center text-[11px] text-zinc-400 transition-colors hover:bg-white/10 hover:text-cyan-400"
                              >
                                {cmd}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })
                  : // Simple menu when no worktrees
                    (() => {
                      const hasAgent = spawnTargets[0]?.agents?.length > 0;
                      return ["claude", "codex", "bash"].map((cmd) => (
                        <button
                          type="button"
                          key={cmd}
                          onClick={() => spawn(cmd, spawnTargets[0].path, hasAgent)}
                          className="whitespace-nowrap rounded px-3 py-1 text-left text-xs text-zinc-300 transition-colors hover:bg-white/10 hover:text-cyan-400"
                        >
                          {cmd}
                        </button>
                      ));
                    })()}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Agent sub-groups */}
      {!collapsed && (
        <div className="ml-1 border-l border-white/5 pl-2">
          {project.worktrees.map((wt) => (
            <WorktreeSection
              key={wt.name}
              worktree={wt}
              selectedTarget={selectedTarget}
              onSelect={onSelectAgent}
            />
          ))}
          {isEmpty && (
            <div className="px-2 py-2 text-[11px] text-zinc-600">No agents — click + to spawn</div>
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
}

// Sub-section for a worktree (or main) within a project
function WorktreeSection({ worktree, selectedTarget, onSelect }: WorktreeSectionProps) {
  return (
    <div className="mb-0.5">
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
