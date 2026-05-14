// Hand-over digest aggregator for the Producer console.
//
// Background — `doc/decisions/2026-05-14-react-producer-console-rebuild.md`
// (cross-refs `tmai-core@doc/decisions/2026-05-13-producer-feedback-loop-
// and-decision-tiers.md`): the Producer's session-start hand-over is
// composed from four sections — ▶ Where-you-left-off, ⬢ Cross-unit
// status, ⬡ Settled decisions, ◐ Working-with-this-human.
//
// Phase A scope (this file): wire what we already have on the client.
//
// - `whereYouLeftOff` — derived from `useAgents` + `useWorktrees`
//   scoped to `currentProjectPath`. Reuses `groupByProject` so the
//   sidebar's worktree shape matches the console's worktree shape
//   exactly (single source of truth for project grouping).
// - `crossUnit` — every project derived from active agents, with a
//   state pill (needs-you / in-progress / quiet). The "unit" here is
//   the *derived* project — not yet read from a `[[unit]]`-config
//   wire endpoint. Phase C will reconcile against
//   `GET /api/units` and surface units that have no live agents.
//
// Placeholders for Phase C wire:
//
// - `settledDecisions` — decision records live in this repo's
//   `doc/decisions/`, but there is no wire endpoint yet to expose
//   their frontmatter (status / tier / temperature) to the WebUI.
//   The section renders an explicit "not yet wired" notice so the
//   operator knows the placeholder is intentional, not a bug.
// - `workingWithHuman` — same shape, same reason. Composed by the
//   Producer's `compose()` baseline builder; needs a read endpoint.
//
// Both placeholders carry the exact wire-gap reason in the `reason`
// field — the section components render that text directly so the
// surface is self-documenting.
//
// Posture annotations (DR `doc/decisions/2026-05-14-webui-simulated-
// onboarded-posture.md`): until tmai-core lands #340 (multi-repo) /
// #341 (cold-start), this hook degrades gracefully and surfaces a
// weak `missingPreconditions` signal so sections can render honest
// notices instead of fabricating data. Anything tagged
// `TODO(tmai-core#340)` / `TODO(tmai-core#341)` in this file is
// scheduled for retirement once those ship.

import { useMemo } from "react";
import { useAgents } from "@/hooks/useAgents";
import { useWorktrees } from "@/hooks/useWorktrees";
import {
  type AgentAttention,
  type AgentSnapshot,
  groupByProject,
  isAiAgent,
  type ProjectGroup,
} from "@/lib/api";

// Canonical AgentId schemes that mark a snapshot as an AI coding agent
// regardless of `agent_type`. Post-2026-05-09 detection canonicalization,
// `id` carries the canonical scheme (`claude:` / `codex:` / `gemini:` /
// `opencode:`) even when the spawn command was wrapped (e.g. the
// Producer launch wraps `tmai producer <unit>` under `bash -c` to
// satisfy tmai-core's `/api/spawn` allow-list — see
// `doc/decisions/2026-05-14-react-producer-console-rebuild.md` polish v4).
// In that wrapped case `agent_type` stays `Custom("bash")` and the
// plain `isAiAgent(agent_type)` check misses the Producer.
//
// TODO(tmai-core spawn-allow-list): when tmai-core's allow-list adds
// `tmai` as a first-class command, the bash wrap goes away and
// `agent_type` will reflect reality — this id-scheme fallback can
// then retire.
const AI_ID_SCHEMES = ["claude:", "codex:", "gemini:", "opencode:"] as const;

function isHandoverAgent(a: AgentSnapshot): boolean {
  if (isAiAgent(a.agent_type)) return true;
  return AI_ID_SCHEMES.some((scheme) => a.id.startsWith(scheme));
}

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
  isOrchestrator: boolean;
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

// Placeholder shapes are intentionally tiny — the section components
// hard-code the user-facing copy so the hook stays free of UI strings.
// (Earlier drafts inlined a `reason` field with "Phase C: <endpoint>
// not yet wired" technical text, which leaked through to the user UI
// and read as broken. Lesson: keep technical reasons out of UI hooks.)
export interface SettledDecisionsPlaceholder {
  placeholder: true;
}

export interface WorkingWithHumanPlaceholder {
  placeholder: true;
}

/**
 * Weak client-side signals that the unit might be incompletely onboarded
 * or that we're only seeing a sliver of its real surface. Per the
 * simulated-onboarded posture DR, the WebUI is not allowed to fabricate
 * data when the underlying wire is absent — it has to be honest about
 * which inferences are based on partial signals.
 *
 * These flags are *weak* by design: they come from the data we already
 * have on the client (agent list, project grouping), not from a
 * dedicated `compose().meta` payload (which is what tmai-core#341 will
 * provide). Section components treat them as "may want to surface a
 * notice", not as definitive state.
 */
export interface MissingPreconditions {
  /** No live agents have been observed for this client session.
   *  Weak signal — also true during the initial agents-fetch pre-load.
   *  TODO(tmai-core#341): replace with `compose().meta` once the wire
   *  endpoint reports actual missing preconditions (no
   *  `doc/decisions/`, no `[[unit]]` config, etc.). */
  noLiveAgents: boolean;
  /** Only one unit derived from live agents. Because the wire side
   *  doesn't yet expose dormant `[[unit]]` configs (#340) or a way
   *  for a unit to span multiple repos (#340), the single-unit
   *  view here is necessarily partial.
   *  TODO(tmai-core#340): replace with `GET /api/units` reconciliation. */
  singleUnitOnly: boolean;
}

export interface HandoverDigest {
  whereYouLeftOff: WhereYouLeftOff;
  crossUnit: CrossUnitStatus;
  settledDecisions: SettledDecisionsPlaceholder;
  workingWithHuman: WorkingWithHumanPlaceholder;
  missingPreconditions: MissingPreconditions;
}

// Narrowing predicate — keeps the AttentionAgentBrief map free of the
// `attention!` non-null-assertion (would survive `noUncheckedIndexedAccess`
// but reads as a code smell against the project's `any`-banned rule).
function isAttentionAgent(a: AgentSnapshot): a is AgentSnapshot & { attention: AgentAttention } {
  return a.attention != null;
}

function deriveUnitState(group: ProjectGroup): UnitState {
  if (group.attentionAgents > 0) return "needs-you";
  if (group.totalAgents > 0) return "in-progress";
  return "quiet";
}

/**
 * Aggregate client-side data into the hand-over digest's four sections.
 *
 * Phase A: `settledDecisions` and `workingWithHuman` are placeholders;
 * see file header for the wire endpoints Phase C will introduce.
 */
export function useHandover(currentProjectPath: string | null): HandoverDigest {
  const { agents } = useAgents();
  const { worktrees } = useWorktrees();

  const aiAgents = useMemo(() => agents.filter(isHandoverAgent), [agents]);

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
      attentionAgents: activeAgents.filter(isAttentionAgent).map((a) => ({
        target: a.target,
        displayName: a.display_name,
        attention: a.attention,
        cwd: a.cwd,
        isOrchestrator: a.is_orchestrator === true,
      })),
    };
  }, [currentProjectPath, projectGroups, aiAgents]);

  const crossUnit = useMemo<CrossUnitStatus>(
    () => ({
      units: projectGroups.map((g) => ({
        path: g.path,
        name: g.name,
        state: deriveUnitState(g),
        agentCount: g.totalAgents,
        attentionCount: g.attentionAgents,
      })),
    }),
    [projectGroups],
  );

  // Plain signal objects — the section components own the user-facing
  // copy. Section identity is stable across renders since the literal
  // is structurally identical, but we still allocate fresh objects to
  // keep the type literal `true` exact.
  const settledDecisions: SettledDecisionsPlaceholder = { placeholder: true };
  const workingWithHuman: WorkingWithHumanPlaceholder = { placeholder: true };

  // Weak posture-signal derivation. See `MissingPreconditions` doc for
  // why these are tagged TODO(tmai-core#NNN) — they get retired once
  // the wire side surfaces the real precondition data.
  const missingPreconditions: MissingPreconditions = {
    noLiveAgents: aiAgents.length === 0,
    singleUnitOnly: projectGroups.length === 1,
  };

  return { whereYouLeftOff, crossUnit, settledDecisions, workingWithHuman, missingPreconditions };
}
