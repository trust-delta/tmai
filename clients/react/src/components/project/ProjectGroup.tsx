import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConfirm } from "@/components/layout/ConfirmDialog";
import { ProducerRoster } from "@/components/project/ProducerRoster";
import type { ProjectGroup as ProjectGroupType, Selection, WorktreeGroup } from "@/lib/api";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface ProjectGroupProps {
  project: ProjectGroupType;
  selection: Selection | null;
  onSelectAgent: (target: string) => void;
  onSpawned: (sessionId: string) => void;
}

// Collapsible unit group, rendered as a Producer-rooted addressing surface
// (DR `2026-05-23-producer-rooted-left-panel.md`): the unit's single live
// Producer is the headline, its workers hang beneath as a subordinate
// roster. The body delegates that hierarchy to `ProducerRoster`; this shell
// keeps the collapsible header + the per-unit emergency spawn `+`. The
// per-project branch-graph + markdown-files buttons retired earlier with the
// git/docs multipane (DR `2026-05-14-react-producer-console-rebuild.md`
// §Refinement 2026-05-22 Fork B).
export function ProjectGroup({ project, selection, onSelectAgent, onSpawned }: ProjectGroupProps) {
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

  // Flatten the worktree sub-groups back into one unit agent list for the
  // Producer-rooted roster. groupByProject already orders these main-first
  // then worktrees sorted by name, so this preserves a stable structural
  // order (no judgment sort — DR §No-judgment).
  const unitAgents = useMemo(
    () => project.worktrees.flatMap((wt) => wt.agents),
    [project.worktrees],
  );

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
      <div className="flex w-full items-center gap-1 rounded-lg px-2 py-1.5 transition-colors hover:bg-surface">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="flex flex-1 items-center gap-2 text-left min-w-0"
        >
          <span
            className={cn(
              "text-[10px] text-subtle-foreground transition-transform shrink-0",
              collapsed && "-rotate-90",
            )}
          >
            ▼
          </span>
          <div className="min-w-0">
            <span
              className={cn(
                "block truncate text-xs font-semibold",
                isEmpty ? "text-muted-foreground" : "text-foreground",
              )}
            >
              {project.name}
            </span>
            {/* Branch info under project name */}
            <div className="flex items-center gap-1.5 mt-0.5">
              {mainBranch && (
                <span className="truncate text-[10px] text-muted-foreground">
                  {mainBranch}
                  {mainDirty && <span className="text-warning">*</span>}
                </span>
              )}
              {worktreeCount > 0 && (
                <span className="flex items-center gap-0.5 text-[10px] text-success">
                  <span>🌿</span>
                  <span>×{worktreeCount}</span>
                  {worktreesDirty && <span className="text-warning">*</span>}
                </span>
              )}
            </div>
          </div>
        </button>
        <div className="flex items-center gap-1.5">
          {project.totalAgents > 0 && (
            <span className="text-[10px] text-subtle-foreground">{project.totalAgents}</span>
          )}
          {project.attentionAgents > 0 && (
            <span className="rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] text-warning">
              {project.attentionAgents}
            </span>
          )}
          {/* Spawn button */}
          <div className="relative" ref={spawnRef}>
            <button
              type="button"
              onClick={() => setShowSpawn((v) => !v)}
              disabled={spawning}
              className="rounded px-1 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-surface-strong hover:text-primary disabled:opacity-50"
              title="Spawn agent"
            >
              +
            </button>
            {showSpawn && (
              <div className="absolute right-0 top-full z-10 mt-1 flex flex-col gap-0.5 rounded-lg border border-hairline-strong bg-surface-strong p-1 shadow-lg min-w-[140px]">
                {hasMultipleTargets
                  ? // Show worktree-grouped spawn options
                    spawnTargets.map((target) => {
                      const hasAgent = target.agents.length > 0;
                      return (
                        <div key={target.name}>
                          <div className="px-2 py-0.5 text-[10px] text-muted-foreground truncate">
                            {target.isWorktree ? "🌿 " : ""}
                            {target.branch || target.name}
                            {hasAgent && (
                              <span className="ml-1 text-warning" title="Agent active">
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
                                className="flex-1 whitespace-nowrap rounded px-2 py-0.5 text-center text-[11px] text-muted-foreground transition-colors hover:bg-surface-strong hover:text-primary"
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
                          className="whitespace-nowrap rounded px-3 py-1 text-left text-xs text-foreground transition-colors hover:bg-surface-strong hover:text-primary"
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

      {/* Producer-rooted roster (Producer headline + subordinate workers) */}
      {!collapsed && (
        <div className="ml-1 border-l border-hairline pl-2">
          {isEmpty ? (
            <div className="px-2 py-2 text-[11px] text-subtle-foreground">
              No agents — click + to spawn
            </div>
          ) : (
            <ProducerRoster
              agents={unitAgents}
              unitPath={project.path}
              selectedTarget={selectedTarget}
              onSelect={onSelectAgent}
            />
          )}
        </div>
      )}
    </div>
  );
}
