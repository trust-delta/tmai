import { useCallback, useSyncExternalStore } from "react";

// Module-level store so the user's per-agent auto-scroll preference survives
// across remounts and across host components (e.g. switching between
// `TerminalPanel` and `PreviewPanel` for the same agent).
//
// Backed by `useSyncExternalStore` (not per-instance `useState` synced from
// the Map) because consumers can be mounted SIMULTANEOUSLY for the same
// agent: the aim-console status strip's `follow` toggle (#803) and the
// chromeless `TerminalPanel` it sits under each call this hook, and a toggle
// in one must reach the other live — a mount-time snapshot would leave the
// terminal pinned to a stale value until remount.
const autoScrollByAgent = new Map<string, boolean>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * `useState`-shaped wrapper that persists the chosen value into a per-agent
 * map keyed by `agentId`. New agents default to `true` (auto-scroll on).
 *
 * The setter accepts both a value and an updater function, mirroring the
 * `useState` setter shape so callers can drop it in without changing
 * call sites. All mounted consumers of the same store re-render on a set,
 * so the value reads the same everywhere — including when `agentId` changes
 * (the snapshot function closes over the current id).
 */
export function useAutoScrollPerAgent(
  agentId: string,
): [boolean, (next: boolean | ((prev: boolean) => boolean)) => void] {
  const autoScroll = useSyncExternalStore(subscribe, () => autoScrollByAgent.get(agentId) ?? true);

  const setAutoScroll = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      const prev = autoScrollByAgent.get(agentId) ?? true;
      const value = typeof next === "function" ? next(prev) : next;
      autoScrollByAgent.set(agentId, value);
      for (const listener of listeners) {
        listener();
      }
    },
    [agentId],
  );

  return [autoScroll, setAutoScroll];
}
