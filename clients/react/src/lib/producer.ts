// Shared Producer resolver.
//
// Both the Producer console digest and the conversation view need to
// pin "the single live Producer for this unit" from the live agent
// list — for the ctx% readout, the Handoff & restart trigger gate, and
// (App-level) the failure-dialog's Force-kill target. This used to be
// copy-pasted verbatim across `ProducerConsoleActions` and
// `ProducerCtxHeader`; it lives here once so every consumer agrees.

import { type AgentSnapshot, normalizeGitDir, type UnitRepoWire } from "@/lib/api";

// Canonical AgentId scheme that marks a Producer-eligible Claude
// session. Per DR `2026-05-14-react-producer-console-rebuild.md`
// polish v4, the Producer is launched as `bash -c "tmai producer
// <unit>"` so `agent_type` is `Custom("bash")` — but the canonical
// `id` is still `claude:UUID` once the L2 promotion lands. We pin to
// the id scheme rather than `agent_type` for the same reason
// `useHandover` does.
export const PRODUCER_ID_SCHEME = "claude:";

/** Find the single live Producer for this unit, if any.
 *
 *  Filter rules (DR §E + scoping pattern from `useHandover`):
 *   1. `id` starts with `claude:` (canonical scheme)
 *   2. `!is_worktree` — Producer runs at the repo root, not in a
 *      worktree clone (worktree Producers would be Worker agents)
 *   3. cwd / `git_common_dir` resolves to the unit's **primary** repo
 *      path — per `UnitRepoWire.primary`, the one repo a unit's
 *      Producer is launched at, even when the unit spans multiple repos
 *
 *  Cross-repo signature (tmai-core #439, wire #460, public types #741):
 *  callers on the units wire pass the unit's full `UnitRepoWire[]`
 *  membership — the function picks the `primary: true` row internally,
 *  so a Producer-shape agent that happens to sit at a NON-primary repo
 *  of the same unit (e.g., an opportunistic Claude session at a
 *  secondary repo) is NOT mis-classified as the unit's Producer.
 *
 *  Back-compat: a single `string` path is treated as the primary repo
 *  directly — for callers (`ProducerCtxHeader`, `ProducerConsoleActions`,
 *  `ProducerRoster`, App-level fallbacks) not yet threaded through the
 *  units wire.
 *
 *  If zero or more than one candidate exists, returns `null` — the
 *  handoff ritual operates on a *single* Producer; we never guess. */
export function findProducerForUnit(
  agents: AgentSnapshot[],
  unitRepos: string | Array<UnitRepoWire> | null,
): AgentSnapshot | null {
  if (unitRepos === null) return null;
  // Resolve the unit's primary repo path. The single-string overload is
  // the back-compat path: a unit known only by its repo dir (no units-
  // wire reconciliation yet) is treated as a one-repo unit whose sole
  // member is the primary.
  let primaryPath: string;
  if (typeof unitRepos === "string") {
    primaryPath = unitRepos;
  } else {
    const primary = unitRepos.find((r) => r.primary);
    // No `primary: true` row → we can't pin a Producer location. Refuse
    // to guess (would re-introduce the single-Producer-invariant gap
    // exactly the way the simulated-onboarded-posture DR forbids).
    if (!primary) return null;
    primaryPath = primary.path;
  }
  const targetPath = normalizeGitDir(primaryPath);
  const candidates = agents.filter((a) => {
    if (!a.id.startsWith(PRODUCER_ID_SCHEME)) return false;
    if (a.is_worktree === true) return false;
    // Normalize both branches: a raw `cwd` fallback would otherwise be
    // compared against an already-normalized `targetPath` and could miss
    // (trailing slash / `.git` suffix).
    const agentRepo = normalizeGitDir(a.git_common_dir ?? a.cwd);
    return agentRepo === targetPath;
  });
  return candidates.length === 1 ? (candidates[0] ?? null) : null;
}
