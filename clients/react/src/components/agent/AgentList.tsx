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
  worktrees: WorktreeSnapshot[];
  onSpawned: (sessionId: string) => void;
}

// The unit addressing surface (DR `2026-05-23-producer-rooted-left-panel.md`).
//
// This panel re-cast the old flat agent registry into a Producer-rooted
// hierarchy: one collapsible group per unit, each headed by the unit's live
// Producer with its workers as a subordinate roster (the per-group structure
// lives in `ProjectGroup` → `ProducerRoster`). The left answers "who am I
// talking to / who's under them"; the right AttentionStrip answers "what
// needs me". The earlier "Operator view (legacy) — bypass the Producer"
// framing is retired: addressing the Producer IS the primary use here, not a
// bypass (this DR partially supersedes the console-rebuild's "sidebar =
// legacy escape hatch" stance — emergency override paths are retained).
//
// Direct operator spawn is dispatch's job for the Producer (briefs), so the
// launcher is folded into the de-emphasized "Advanced / emergency" footer
// rather than the prominent top slot it used to own. Cross-unit navigation
// still lives in the ProducerConsole digest / AttentionStrip, not here.
export function AgentList({
  agents,
  loading,
  selection,
  onSelectAgent,
  worktrees,
  onSpawned,
}: AgentListProps) {
  const projects = useMemo(() => groupByProject(agents, worktrees), [agents, worktrees]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Initializing...
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto p-2">
      {projects.length === 0 ? (
        <p className="px-2 py-6 text-center text-xs text-subtle-foreground">
          No agents yet — dispatch is the Producer's job. Use Advanced below only for an emergency
          direct spawn.
        </p>
      ) : (
        projects.map((project) => (
          <ProjectGroup
            key={project.path}
            project={project}
            selection={selection}
            onSelectAgent={onSelectAgent}
            onSpawned={onSpawned}
          />
        ))
      )}

      {/* Spawn is an emergency-only affordance: dispatch belongs to the
          Producer (briefs), so the operator's direct launcher sits behind a
          de-emphasized, collapsed-by-default disclosure at the bottom rather
          than the prominent top slot it used to hold. */}
      <details className="mt-auto border-t border-hairline pt-2">
        <summary className="cursor-pointer select-none px-2 py-1 text-[10px] uppercase tracking-wider text-subtle-foreground transition-colors hover:text-muted-foreground">
          Advanced — emergency spawn
        </summary>
        <div className="mt-1">
          <NewAgentLauncher onSpawned={onSpawned} />
        </div>
      </details>
    </div>
  );
}
