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
// the id scheme rather than `agent_type` because the scheme is the
// stable identity across the bash-wrap indirection.
export const PRODUCER_ID_SCHEME = "claude:";

/** The parent directory of an absolute path, or `null` when it has no
 *  proper parent (root, or a single leading-slash segment). Used to
 *  recognize a Producer launched at the unit's WRAPPER directory — the
 *  parent that holds the unit's member repos — under the wrapper-dir
 *  project model (tmai-core #529/#530). */
function parentDir(path: string): string | null {
  const i = path.lastIndexOf("/");
  if (i <= 0) return null;
  return path.slice(0, i);
}

/** Find the single live Producer for this unit, if any.
 *
 *  Filter rules (unit-scoped, Producer-identity based):
 *   1. `id` starts with `claude:` (canonical scheme)
 *   2. `!is_worktree` — Producer runs at the repo root (or the unit
 *      wrapper), not in a worktree clone (worktree Producers would be
 *      Worker agents)
 *   3. EITHER of:
 *      a. **Adopt-resilient identity** (#834): `is_producer === true`
 *         AND `unit` equals this unit's name. Both fields are set at
 *         PTY-server **adopt** (`is_producer` is derived from the `role`
 *         spawn hint — tmai-core #527; `unit` is the #443/#533
 *         hook-resilient wire field), so they resolve the Producer the
 *         instant the engine comes back — BEFORE any conversation turn
 *         re-fires the statusline hook. The cwd key below cannot: cwd /
 *         `git_common_dir` are hook-derived and stale at restart-adopt, so
 *         a cwd-only resolver shows "no active session" until the operator
 *         types — a bootstrap deadlock once the aim-console is the sole
 *         surface (there is no legacy terminal left to fire that first
 *         hook). NB the live wire field on `AgentSnapshot` is `is_producer`
 *         (verified against the running `GET /api/agents` payload). The
 *         hand-written `AgentSnapshot` type ALSO declares a stale
 *         `is_orchestrator` from before the orchestrator→producer rename,
 *         but the engine does not serve it — keying on it is a no-op (#834).
 *      b. cwd / `git_common_dir` resolves to the unit's **primary** repo
 *         path (per `UnitRepoWire.primary`) — OR to the unit's WRAPPER dir,
 *         the parent of that repo. The wrapper-dir project model (tmai-core
 *         #529/#530) launches the Producer at the wrapper (which is not
 *         itself a git repo), so its resolved dir sits one level above the
 *         primary repo path; both positions count. This is the steady
 *         state once the hook has fired, AND the back-compat path for an
 *         engine not yet serving `is_producer` / `unit`: those are
 *         absent on the wire then, rule 3a never fires, and the resolver
 *         degrades to exactly the prior cwd-keying.
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
  // Wrapper-dir project model (tmai-core #529/#530): a unit's Producer is
  // launched at the unit's WRAPPER directory — the parent that holds the
  // auto-discovered member repos — not at a repo root. That Producer's cwd
  // is the wrapper, which is not itself a git repo (no `git_common_dir`),
  // so its resolved `agentRepo` is one level ABOVE the primary repo path.
  // Accept that position as well; otherwise a wrapper-launched Producer
  // never resolves and every "talk to the Producer" surface (the aim-console
  // session pane included) shows "no active session".
  const wrapperPath = parentDir(targetPath);
  // The unit name, derived from the primary repo's basename. By tmai's
  // project model the primary repo's basename IS the unit name — the same
  // derivation App uses for its `unitName` and `groupByProject` for its
  // path pick — so a Producer whose adopt-resilient `unit` field equals it
  // is this unit's Producer. `null` when the path has no basename (we then
  // never identity-match, falling through to the cwd key).
  const unitName = targetPath.split("/").filter(Boolean).pop() ?? null;
  const candidates = agents.filter((a) => {
    if (!a.id.startsWith(PRODUCER_ID_SCHEME)) return false;
    if (a.is_worktree === true) return false;
    // Rule 3a — adopt-resilient identity. Resolves the Producer at
    // restart-adopt, before the hook re-derives cwd. `is_producer`
    // narrows `unit` (which a worker shares) down to the single Producer,
    // preserving the non-primary-repo guard: a same-unit worker sitting at
    // a secondary repo is `is_producer !== true`, so it never matches.
    if (a.is_producer === true && unitName !== null && a.unit === unitName) {
      return true;
    }
    // Rule 3b — cwd / `git_common_dir` position. Normalize both branches:
    // a raw `cwd` fallback would otherwise be compared against an
    // already-normalized `targetPath` and could miss (trailing slash /
    // `.git` suffix).
    const agentRepo = normalizeGitDir(a.git_common_dir ?? a.cwd);
    return agentRepo === targetPath || (wrapperPath !== null && agentRepo === wrapperPath);
  });
  return candidates.length === 1 ? (candidates[0] ?? null) : null;
}
