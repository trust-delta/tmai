import { useCallback, useEffect, useState } from "react";

// Module-level Map so the user's per-agent auto-scroll preference survives
// across remounts and across host components (e.g. switching between
// `TerminalPanel` and `PreviewPanel` for the same agent). Living here
// rather than per-component state lets both consumers see the same value.
const autoScrollByAgent = new Map<string, boolean>();

/**
 * `useState`-shaped wrapper that persists the chosen value into a per-agent
 * map keyed by `agentId`. New agents default to `true` (auto-scroll on).
 *
 * The setter accepts both a value and an updater function, mirroring the
 * `useState` setter shape so callers can drop it in without changing
 * call sites. When `agentId` changes (the parent reuses the same component
 * instance with a different agent), the state is re-synchronized from the
 * cache so the UI reflects the previously-toggled preference for the
 * newly-focused agent.
 */
export function useAutoScrollPerAgent(
  agentId: string,
): [boolean, (next: boolean | ((prev: boolean) => boolean)) => void] {
  const [autoScroll, setRaw] = useState<boolean>(() => autoScrollByAgent.get(agentId) ?? true);

  // Re-sync from the cache when the host swaps agents without remounting.
  useEffect(() => {
    setRaw(autoScrollByAgent.get(agentId) ?? true);
  }, [agentId]);

  const setAutoScroll = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      setRaw((prev) => {
        const value = typeof next === "function" ? next(prev) : next;
        autoScrollByAgent.set(agentId, value);
        return value;
      });
    },
    [agentId],
  );

  return [autoScroll, setAutoScroll];
}
