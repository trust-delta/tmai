import { useEffect, useRef } from "react";
import type { AgentSnapshot, Selection } from "@/lib/api-http";

interface UseAgentSelectionFallbackArgs {
  selection: Selection | null;
  selectedAgent: AgentSnapshot | undefined;
  agents: AgentSnapshot[];
  setSelection: (next: Selection | null) => void;
}

// Sort key for "first agent in this group": orchestrator wins, then
// insertion order. Mirrors `WorktreeSection` in ProjectGroup so the
// fallback target matches what the sidebar renders at the top of the
// group the user was already looking at.
function sortByOrchestratorFirst(agents: AgentSnapshot[]): AgentSnapshot[] {
  return [...agents].sort((a, b) => {
    if (a.is_orchestrator && !b.is_orchestrator) return -1;
    if (!a.is_orchestrator && b.is_orchestrator) return 1;
    return 0;
  });
}

function pickSibling(agents: AgentSnapshot[], prevCwd: string | null): AgentSnapshot | undefined {
  if (prevCwd) {
    const sameCwd = agents.filter((a) => a.cwd === prevCwd);
    const pick = sortByOrchestratorFirst(sameCwd)[0];
    if (pick) return pick;
  }
  return sortByOrchestratorFirst(agents)[0];
}

/**
 * Move selection to a sibling agent when the previously-resolved one
 * disappears from `agents` (kill button, CC quit, dispatch unwind, …).
 * Prefers "same cwd, orchestrator first" so the user lands in the same
 * project group; falls back to any first agent; clears selection only
 * when the entity list is empty.
 *
 * Why key off the *resolved* target rather than `selection.id`: a fresh
 * spawn updates `selection.id` to the spawn-time session id well before
 * the wire round-trip lands an `AgentSnapshot`, and during that gap
 * `selectedAgent` is briefly `undefined`. Reacting to that gap as if the
 * old agent had died would yank focus away from the freshly-spawned
 * agent before it ever became visible.
 *
 * Why a hook instead of inline in App.tsx: the "previously resolved"
 * state needs ref-tracking across renders, and the death-detection
 * branches (same-cwd / any-cwd / none) are easier to unit-test as a
 * pure module than nested under App's render path.
 */
export function useAgentSelectionFallback({
  selection,
  selectedAgent,
  agents,
  setSelection,
}: UseAgentSelectionFallbackArgs): void {
  const prevTargetRef = useRef<string | null>(null);
  const prevCwdRef = useRef<string | null>(null);

  useEffect(() => {
    if (selectedAgent) {
      prevTargetRef.current = selectedAgent.target;
      prevCwdRef.current = selectedAgent.cwd;
      return;
    }
    const prevTarget = prevTargetRef.current;
    const prevCwd = prevCwdRef.current;
    if (!prevTarget) return;
    // Pre-resolution gap (e.g. just-spawned id not yet wire-delivered).
    // Leave selection alone — wire arrival will resolve it momentarily.
    if (agents.some((a) => a.target === prevTarget)) return;

    prevTargetRef.current = null;
    prevCwdRef.current = null;
    const sibling = pickSibling(agents, prevCwd);
    if (sibling) {
      setSelection({ type: "agent", id: sibling.target });
    } else if (selection?.type === "agent") {
      // Only clear when the dead selection was an agent — if the user
      // moved on to a worktree/project view themselves, preserve that.
      setSelection(null);
    }
  }, [selectedAgent, agents, selection, setSelection]);
}
