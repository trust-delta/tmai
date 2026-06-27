// Hand-over digest aggregator for the Producer console.
//
// Background — `doc/decisions/2026-05-14-react-producer-console-rebuild.md`
// (cross-refs `tmai-core@doc/decisions/2026-05-13-producer-feedback-loop-
// and-decision-tiers.md`): the Producer's session-start hand-over is
// composed from four sections — ▶ Where-you-left-off, ⬢ Cross-unit
// status, ⬡ Settled decisions, ◐ Working-with-this-human.
//
// - `whereYouLeftOff` — derived from `useAgents` + `useWorktrees`
//   scoped to `currentProjectPath`. Reuses `groupByProject` so the
//   sidebar's worktree shape matches the console's worktree shape
//   exactly (single source of truth for project grouping).
// - `crossUnit` — reconciles two sources so the section reflects the
//   FULL configured-unit space, not only what's running:
//     • configured-unit MEMBERSHIP comes from `api.units()` (tmai-core
//       #460 wire half of #439, public types mirror tmai#741); membership
//       only — no server-side state pill, no server-side live-agent join;
//     • the per-unit STATE PILL (needs-you / in-progress / quiet) is
//       still derived client-side from the live agent list.
//   A unit configured but currently dormant (no live agent) shows up
//   here with state `quiet`. Reconciliation closes the gap the Phase-A
//   "live-agent derivation only" implementation left behind.
//
// Both compose-driven sections (`⬡ Settled decisions` and `◐ Working
// with this human`) are wired directly to their own endpoints — the
// sections own their own polling via `useDecisions(unitName)` /
// `useWorkingWithHuman(unitName)` rather than receiving data from this
// hook. The hook keeps only the client-derived signals.
//
// Posture annotation (DR `doc/decisions/2026-05-14-webui-simulated-
// onboarded-posture.md`): the `noLiveAgents` flag survives — that
// compensation is independent of the units wire and stays useful for
// the "agents-fetch pre-load" honest-degradation branch. The
// `singleUnitOnly` companion is gone now that dormant configured units
// are surfaced via reconciliation.

import { useMemo } from "react";
import { useAgents } from "@/hooks/useAgents";
import { useUnits } from "@/hooks/useUnits";
import { useWorktrees } from "@/hooks/useWorktrees";
import {
  type AgentAttention,
  groupByProject,
  hasAttention,
  isAiAgentLoose,
  type ProjectGroup,
} from "@/lib/api";

// The `isAiAgentLoose` helper (centralized in `@/lib/api`) handles the
// bash-wrapped Producer case for us — when the spawn is wrapped under
// `bash -c` to satisfy tmai-core's `/api/spawn` allow-list, the
// `agent_type` stays `Custom("bash")` but the canonical id scheme
// (`claude:` / `codex:` / `gemini:` / `opencode:`) still identifies
// the underlying AI agent. The hand-over digest needs the loose
// classifier so that wrapped Producer doesn't drop out of
// `projectGroups` and break the cross-unit derivation.

export interface WorktreeBrief {
  name: string;
  branch: string | null;
  path: string;
  isMain: boolean;
  dirty: boolean;
  agentCount: number;
}

export interface AttentionAgentBrief {
  target: string;
  displayName: string;
  attention: AgentAttention;
  cwd: string;
  isProducer: boolean;
}

export interface WhereYouLeftOff {
  activeProjectPath: string | null;
  activeProjectName: string | null;
  worktrees: WorktreeBrief[];
  /** Agents waiting on the user, scoped to the active project when one is
   *  selected; falls back to all AI agents otherwise so the operator still
   *  sees what's blocked even with no project selected. */
  attentionAgents: AttentionAgentBrief[];
}

export type UnitState = "needs-you" | "in-progress" | "quiet";

export interface UnitStatus {
  path: string;
  name: string;
  state: UnitState;
  agentCount: number;
  attentionCount: number;
}

export interface CrossUnitStatus {
  units: UnitStatus[];
}

/**
 * Weak client-side signals that the live agent observation may be a
 * sliver of the unit's real surface. Per the simulated-onboarded posture
 * DR, the WebUI must not fabricate data when the underlying wire is
 * absent — section components treat this as "may want to surface a
 * notice", not as definitive state.
 *
 * The `singleUnitOnly` flag this used to carry is retired: dormant
 * configured units are now surfaced via the `api.units()` reconciliation
 * in `crossUnit` (tmai-core #460), so there is no longer a multi-unit
 * gap for the cross-unit section to apologise for.
 */
export interface MissingPreconditions {
  /** No live agents have been observed for this client session.
   *  Weak signal — also true during the initial agents-fetch pre-load.
   *  TODO(tmai-core#341): replace with `compose().meta` once the wire
   *  endpoint reports actual missing preconditions (no
   *  `doc/decisions/`, no `[[unit]]` config, etc.). */
  noLiveAgents: boolean;
}

export interface HandoverDigest {
  whereYouLeftOff: WhereYouLeftOff;
  crossUnit: CrossUnitStatus;
  missingPreconditions: MissingPreconditions;
}

function deriveUnitState(group: ProjectGroup): UnitState {
  if (group.attentionAgents > 0) return "needs-you";
  if (group.totalAgents > 0) return "in-progress";
  return "quiet";
}

/**
 * Aggregate client-side data into the hand-over digest's client-derived
 * sections. The two compose-driven sections (`⬡ Settled decisions`,
 * `◐ Working with this human`) are now wired directly to their own
 * endpoints — `SettledDecisionsSection` + `WorkingWithThisHumanSection`
 * each own their own polling hook.
 */
export function useHandover(currentProjectPath: string | null): HandoverDigest {
  const { agents } = useAgents();
  const { worktrees } = useWorktrees();
  const { data: unitsData } = useUnits();

  const aiAgents = useMemo(() => agents.filter(isAiAgentLoose), [agents]);

  const projectGroups = useMemo<ProjectGroup[]>(
    () => groupByProject(aiAgents, worktrees),
    [aiAgents, worktrees],
  );

  const whereYouLeftOff = useMemo<WhereYouLeftOff>(() => {
    const active = currentProjectPath
      ? (projectGroups.find((g) => g.path === currentProjectPath) ?? null)
      : null;

    const activeAgents = active ? active.worktrees.flatMap((wt) => wt.agents) : aiAgents;

    return {
      activeProjectPath: active?.path ?? null,
      activeProjectName: active?.name ?? null,
      worktrees: active
        ? active.worktrees.map((wt) => ({
            name: wt.name,
            branch: wt.branch,
            path: wt.path,
            isMain: !wt.isWorktree,
            dirty: wt.dirty,
            agentCount: wt.agents.length,
          }))
        : [],
      attentionAgents: activeAgents.filter(hasAttention).map((a) => ({
        target: a.target,
        displayName: a.display_name,
        attention: a.attention,
        cwd: a.cwd,
        // Keys on `is_producer` — the wire field (DR `2026-05-16-producer-
        // identity-and-operator-addressing` §B). The stale `is_orchestrator`
        // read always yielded `false`, misclassifying the Producer (#836).
        isProducer: a.is_producer === true,
      })),
    };
  }, [currentProjectPath, projectGroups, aiAgents]);

  const crossUnit = useMemo<CrossUnitStatus>(() => {
    // Live-agent-derived rows first — these carry real `state` /
    // `agentCount` / `attentionCount` from the live snapshot.
    const liveRows: UnitStatus[] = projectGroups.map((g) => ({
      path: g.path,
      name: g.name,
      state: deriveUnitState(g),
      agentCount: g.totalAgents,
      attentionCount: g.attentionAgents,
    }));

    // Reconcile against the configured-unit membership wire (tmai-core
    // #460): any configured unit without a corresponding live-agent row
    // is appended with state `quiet`. The membership row's `path` is the
    // unit's PRIMARY repo (per `UnitRepoWire.primary`) so selecting a
    // dormant row sets `currentProject` to the same path a fresh
    // Producer launch would land at — keeps unit selection / spawn cwd
    // / `findProducerForUnit` resolution all on the same path key.
    if (!unitsData) {
      // Wire not yet loaded — fall back to live-only. Reconciliation
      // catches up on the next render once `useUnits` resolves.
      return { units: liveRows };
    }

    // Match configured units against live rows by unit NAME — the
    // grouping key in `groupByProject` is the agent's `unit` field
    // (which is exactly the configured unit name) when present, and the
    // primary repo's basename (which by convention equals the unit
    // name) when not. Either way the `name` field on `liveRows`
    // collides with the configured-unit name in the same-shape unit case.
    const liveNames = new Set(liveRows.map((r) => r.name));

    const dormantRows: UnitStatus[] = [];
    for (const unit of unitsData.units) {
      if (liveNames.has(unit.name)) continue;
      const primary = unit.repos.find((r) => r.primary);
      // No primary row on the wire → cannot pin a selection target.
      // Drop the dormant entry rather than fabricate a path; the
      // membership view always carries a primary in practice and a
      // missing primary signals a wire-side bug we shouldn't paper over.
      if (!primary) continue;
      dormantRows.push({
        path: primary.path,
        name: unit.name,
        state: "quiet",
        agentCount: 0,
        attentionCount: 0,
      });
    }

    // Stable order: live rows in their existing order (preserves
    // `groupByProject`'s name-sort), then dormant rows sorted by name
    // so the section's reading order stays predictable across renders.
    dormantRows.sort((a, b) => a.name.localeCompare(b.name));
    return { units: [...liveRows, ...dormantRows] };
  }, [projectGroups, unitsData]);

  // Weak posture-signal derivation. `noLiveAgents` survives the units-
  // wire landing — it's still useful for the agents-fetch pre-load
  // honest-degradation branch (and for distinguishing "you haven't
  // spawned anything yet" from "your unit is configured but quiet").
  const missingPreconditions: MissingPreconditions = {
    noLiveAgents: aiAgents.length === 0,
  };

  return { whereYouLeftOff, crossUnit, missingPreconditions };
}
