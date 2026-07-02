// Close a unit's Producer slot — the webui half of the tmai-core #540 / #546
// Producer-slot lifecycle (`post_close_unit_slot`).
//
// Two-step kill, because the kill targets split across the engine / webui
// ownership boundary:
//
//   1. `POST /api/units/{unit}/close` — the engine kills the live Producer +
//      its dispatched workers and stops the auto-respawn supervisor. This is a
//      KILL, not a delete: worktrees and uncommitted work stay on disk.
//   2. After the close returns, the webui kills the unit's FOOTER BASH itself.
//      The footer shells (`BashFooter`) are plain, hint-less `bash` PTYs the
//      webui spawned at the unit's repo cwds; the engine can't attribute them
//      to the unit on close (no `unit` hint on a bare shell), so the side that
//      OWNS the id — the webui — is responsible for killing them.
//
// Step 2 only runs if step 1 succeeds (the close confirms the operator intent);
// a footer-kill failure is best-effort (`allSettled`) — a stale/dead shell that
// can't be killed must not mask a successful close.

import { type AgentSnapshot, api, isAiAgentLoose, normalizeGitDir } from "@/lib/api";
import type { SlotResponse } from "@/types/generated/SlotResponse";

// The webui-owned footer shells for a unit: plain (NON-AI) `bash` sessions
// whose cwd is one of the unit's repos. `isAiAgentLoose` excludes the
// bash-wrapped Producer and the workers (canonical `claude:`/`codex:`/… ids),
// so this matches only the BashFooter's per-repo + ad-hoc shells — the same
// normalized-cwd identity `BashFooter.findExistingBash` re-attaches on.
export function findFooterShells(unit: SlotResponse, agents: AgentSnapshot[]): AgentSnapshot[] {
  const repoPaths = new Set(unit.repos.map((r) => normalizeGitDir(r.path)));
  return agents.filter((a) => !isAiAgentLoose(a) && repoPaths.has(normalizeGitDir(a.cwd)));
}

// Close the unit's Producer slot, then kill its footer bash. Throws if the
// core close itself fails (so the caller can surface it and skip the
// footer-kill); footer-kill failures are swallowed (best-effort).
export async function closeUnitSlot(unit: SlotResponse, agents: AgentSnapshot[]): Promise<void> {
  await api.closeUnit(unit.name);
  const shells = findFooterShells(unit, agents);
  await Promise.allSettled(shells.map((a) => api.killAgent(a.target)));
}
