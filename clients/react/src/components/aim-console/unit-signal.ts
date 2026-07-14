// unit-signal — the per-unit cross-unit tab signal (aim `1-worktree-merge`'s
// children: the cross-unit tab-signal family — `cross-unit-operator-owed`,
// `cross-unit-remote-delta`, `cross-unit-idle-passive`,
// `cross-unit-operator-call`). Each unit tab carries ONE signal dot, so when a
// unit has several live signals at once they are precedence-COLLAPSED to the
// single dot the operator sees.
//
// Precedence (operator-chosen, hub AskUserQuestion 2026-07-14): owed > fresh >
// idle > none. A unit that is both `owed` AND `fresh` shows `owed`; freshness
// resurfaces once the owe clears. `owed` (an operator act is required) wins
// because it is the only lane that blocks progress; freshness/idle are
// appraise-if-you-want.
//
// This is the generic CONTAINER for all four sibling signals. Only the `owed`
// source is wired today (handoff `AwaitingReview` —
// `cross-unit-operator-owed`); `fresh` (`cross-unit-remote-delta`) and `idle`
// (`cross-unit-idle-passive`) are declared here so their sources drop in
// without re-architecting the tab, and `owed` will later also be fed by the
// Producer's MCP present-state raise (`cross-unit-operator-call`).

export type UnitSignal = "owed" | "fresh" | "idle";

export interface UnitSignalSources {
  /** An operator act is owed on this unit before it can proceed. Wired today
   *  from the handoff review gate (`handoffOwesReview`); later also the
   *  Producer's MCP present-state raise (`cross-unit-operator-call`). */
  owed?: boolean;
  /** Unobserved remote artifact (PR / issue / CI change) —
   *  `cross-unit-remote-delta`. Deferred source (not yet cross-unit). */
  fresh?: boolean;
  /** Producer yielded + no active worker + quiet — `cross-unit-idle-passive`.
   *  Deferred source. */
  idle?: boolean;
}

/**
 * Collapse the (possibly several) live sources to the single highest-
 * precedence signal the tab dot renders, or `null` when the unit is quiet.
 * Precedence: owed > fresh > idle.
 */
export function resolveUnitSignal(sources: UnitSignalSources): UnitSignal | null {
  if (sources.owed) return "owed";
  if (sources.fresh) return "fresh";
  if (sources.idle) return "idle";
  return null;
}

/**
 * The one source wired today. A unit whose latest handoff-ritual phase is
 * `awaiting_review` owes the operator an approve / request-rewrite act: the
 * old Producer is PAUSED at the review gate and cannot MCP-raise for itself,
 * so the owe is derived from the (already global, unit-tagged)
 * `handoff_ritual` SSE phase rather than an agent declaration. Any later
 * forward phase (killed / launching / ready) or an `escalate` supersedes
 * `awaiting_review`, so the owe clears mechanically with no explicit lower.
 */
export function handoffOwesReview(latestPhase: string | undefined): boolean {
  return latestPhase === "awaiting_review";
}
