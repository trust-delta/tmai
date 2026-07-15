// unit-idle — the cross-unit idle-passive source (aim `cross-unit-idle-passive`).
//
// A unit is idle when its Producer's terminal is QUIESCENT (producing no
// output) AND no worker in the unit is still active (non-quiescent). `quiescent`
// is the vendor-neutral core signal (tmai-core: a terminal static beyond the
// idle threshold — a working CLI agent redraws a spinner continuously, an idle
// one is static), so this needs NO Claude-Code hook turn-state.
//
// Low-confidence BY DESIGN: it reports "nothing is moving," not "the operator is
// needed" — a dim hint. Any higher-precedence signal (owed / fresh) collapses it
// away in `resolveUnitSignal` (owed > fresh > idle), so an idle unit that also
// owes a review shows owed, never the dim idle dot.

import type { AgentSnapshot, UnitRepoWire } from "@/lib/api";
import { findProducerForUnit } from "@/lib/producer";

/**
 * Is this unit idle — Producer quiescent and no active (non-quiescent) worker?
 *
 * `unitRepos` is the slot's `repos` membership (or a bare primary-repo string),
 * threaded to `findProducerForUnit` so a same-unit worker sitting at a secondary
 * repo is never mistaken for the Producer.
 */
export function unitIsIdle(
  agents: AgentSnapshot[],
  unitName: string,
  unitRepos: string | UnitRepoWire[] | null,
): boolean {
  const producer = findProducerForUnit(agents, unitRepos);
  // No resolvable Producer, or its terminal is still moving → not idle. Absent
  // `quiescent` (agent still active / engine not yet serving it) reads falsy.
  if (producer?.quiescent !== true) return false;
  // Any LIVE worker in the unit still producing output means the unit is
  // progressing — an idle (quiescent) worker does not count as active, and a
  // dead worker's record lingers but is not active.
  const workerActive = agents.some(
    (a) => !a.is_producer && !a.dead && a.unit === unitName && a.quiescent !== true,
  );
  return !workerActive;
}
