// Shared fetch/poll resource for the R-panel data hooks.
//
// Every R-panel data hook (`useUnitInventory`, `useDecisions`, `usePrBody`,
// `useIssueDetail`, …) was a hand-duplicated copy of the same shape: a
// `{ data, loading, error }` triple, a `generationRef` guard so a stale
// in-flight response from a previously selected unit/PR never stamps over the
// current one, a `null` dep that parks the hook, and (for the list hooks) a
// 60s poll. This consolidates that shape into one place and — critically —
// closes the bug every copy shared: the cleanup never invalidated the
// in-flight fetch, so a response that resolved AFTER unmount called `setState`
// on a gone component. React 19's `resolveUpdatePriority` reads `window`
// during that update; under the jsdom test teardown `window` is already gone,
// so it threw `ReferenceError: window is not defined` — an unhandled error
// Vitest attributes to whichever test was mid-flight, failing the whole suite
// nondeterministically. Bumping the generation in the cleanup drops the late
// response on every path (depKey change, park, and unmount).

import { useCallback, useEffect, useRef, useState } from "react";

export interface PolledResource<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  /**
   * Imperatively re-fetch under the CURRENT generation, keeping the previous
   * response visible while in flight (anti-flicker, same as the poll tick). A
   * no-op while parked (`depKey === null`). Consumers that mutate server state
   * (a capture / create / edit POST) call this so the persisted record shows
   * immediately instead of waiting on the next poll tick.
   */
  refresh: () => void;
}

export interface PolledResourceOptions {
  /**
   * When set, re-fetch every `intervalMs` after the initial load (the R₁ list
   * hooks' 60s poll). Omit for a one-shot resource (the R₂ detail hooks):
   * fetch once per `depKey` change, no interval.
   */
  intervalMs?: number;
}

/**
 * Own the `{ data, loading, error }` triple for a fetched (optionally polled)
 * resource, with a generation guard that drops:
 *   - a response from a previous `depKey` (a stale unit / selection), and
 *   - a response that resolves AFTER unmount or park — the cleanup bumps the
 *     generation, so the late `setState` is skipped (see the file header for
 *     why a post-unmount `setState` is fatal under the jsdom test teardown).
 *
 * `depKey` is the stable request identity (e.g. the unit, or `${repo}#${n}`);
 * the effect re-runs only when it changes, and `depKey === null` parks the
 * hook (no fetch, no interval, cleared state). `fetcher` is read through a ref
 * so a fresh closure each render does not retrigger the effect — the effect's
 * only trigger is a `depKey` change, which is exactly when the fetcher's
 * captured args change too.
 */
export function usePolledResource<T>(
  depKey: string | null,
  fetcher: () => Promise<T>,
  options: PolledResourceOptions = {},
): PolledResource<T> {
  const { intervalMs } = options;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(depKey !== null);
  const [error, setError] = useState<Error | null>(null);
  const generationRef = useRef(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  // The live depKey, so the stable `refresh` callback can no-op while parked
  // without being re-created on every depKey change.
  const depKeyRef = useRef(depKey);
  depKeyRef.current = depKey;

  // One generation-guarded fetch, keeping the previous response visible
  // (anti-flicker). `gen` is captured by the caller so the response is dropped
  // once the generation has moved on (depKey change, park, or unmount).
  const runFetch = useCallback(async (gen: number) => {
    try {
      const res = await fetcherRef.current();
      if (gen !== generationRef.current) return;
      setData(res);
      setError(null);
    } catch (e) {
      if (gen !== generationRef.current) return;
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      if (gen === generationRef.current) setLoading(false);
    }
  }, []);

  const refresh = useCallback(() => {
    if (depKeyRef.current === null) return;
    // Re-fetch under the CURRENT generation, no data clear — the poll path's
    // anti-flicker behaviour, triggered on demand after an operator write.
    void runFetch(generationRef.current);
  }, [runFetch]);

  useEffect(() => {
    if (depKey === null) {
      // Park: invalidate any in-flight fetch from the previous depKey so a
      // late response can't stamp data after we have cleared it.
      generationRef.current += 1;
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
    const myGen = ++generationRef.current;
    // Clear on depKey *change* so a previous selection's data is never shown
    // under the new one. The interval re-poll / `refresh` keep the last
    // response visible (anti-flicker) — only this change-driven path clears.
    setData(null);
    setError(null);
    setLoading(true);

    void runFetch(myGen);

    if (intervalMs === undefined) {
      // One-shot: still invalidate this generation on unmount so a late
      // response is dropped rather than setState-ing a gone component.
      return () => {
        generationRef.current += 1;
      };
    }
    const id = window.setInterval(() => {
      void runFetch(myGen);
    }, intervalMs);
    return () => {
      generationRef.current += 1;
      window.clearInterval(id);
    };
  }, [depKey, intervalMs, runFetch]);

  return { data, loading, error, refresh };
}
