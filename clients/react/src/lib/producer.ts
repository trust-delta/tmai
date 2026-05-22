// Shared Producer resolver.
//
// Both the Producer console digest and the conversation view need to
// pin "the single live Producer for this unit" from the live agent
// list — for the ctx% readout, the Handoff & restart trigger gate, and
// (App-level) the failure-dialog's Force-kill target. This used to be
// copy-pasted verbatim across `ProducerConsoleActions` and
// `ProducerCtxHeader`; it lives here once so every consumer agrees.

import { type AgentSnapshot, normalizeGitDir } from "@/lib/api";

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
 *   3. cwd / `git_common_dir` resolves to the unit's repo path
 *
 *  If zero or more than one candidate exists, returns `null` — the
 *  handoff ritual operates on a *single* Producer; we never guess. */
export function findProducerForUnit(
  agents: AgentSnapshot[],
  unitRepoPath: string | null,
): AgentSnapshot | null {
  if (unitRepoPath === null) return null;
  const targetPath = normalizeGitDir(unitRepoPath);
  const candidates = agents.filter((a) => {
    if (!a.id.startsWith(PRODUCER_ID_SCHEME)) return false;
    if (a.is_worktree === true) return false;
    const agentRepo = a.git_common_dir ? normalizeGitDir(a.git_common_dir) : a.cwd;
    return agentRepo === targetPath;
  });
  return candidates.length === 1 ? (candidates[0] ?? null) : null;
}
