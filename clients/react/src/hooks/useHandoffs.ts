// Fetch hooks for the R₂ in-tmai Hand-over viewer — the operator-side half
// of tmai-core PR #473's handoffs endpoint.
//
// `useHandoffs(unit)` is the LIST hook (mirrors `useDecisions` /
// `useCalibration`): a 60-second poll over the unit's baton inventory
// (active first, then archived newest-first — the wire order). Batons
// change only when a hand-over ritual completes (minutes to hours), so a
// 60s poll is plenty; SSE is a deferred follow-up like the other R₁
// sections. A `null` unit parks the hook (no fetch, no interval).
//
// `useHandoffContent(unit, name)` is the one-shot CONTENT hook (mirrors
// `usePrDetail`'s `usePrResource`): it fetches a single baton's raw
// markdown only after an explicit operator click on a row, with a
// generation guard so a stale in-flight response from a previously selected
// baton never stamps over the current one. It parks when EITHER arg is
// null.

import { useEffect, useRef, useState } from "react";
import { api, type HandoffContentResponse, type HandoffsResponse } from "@/lib/api";

const POLL_INTERVAL_MS = 60_000;

export interface UseHandoffsResult {
  data: HandoffsResponse | null;
  loading: boolean;
  error: Error | null;
}

/**
 * Poll the unit's hand-over baton list at `POLL_INTERVAL_MS`. Returns the
 * latest response, an initial-load `loading` flag, and the most recent
 * error (cleared on a successful fetch).
 *
 * `unit = null` parks the hook: no fetch, no interval, no data — the R₁
 * section renders its "pick a project" placeholder rather than poll a
 * non-existent unit.
 */
export function useHandoffs(unit: string | null): UseHandoffsResult {
  const [data, setData] = useState<HandoffsResponse | null>(null);
  const [loading, setLoading] = useState(unit !== null);
  const [error, setError] = useState<Error | null>(null);
  // Track the latest fetch so an in-flight response from a previous unit
  // cannot stamp over a newer unit's data.
  const generationRef = useRef(0);

  useEffect(() => {
    if (!unit) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
    const myGen = ++generationRef.current;
    // Clear on unit *change* so a previous unit's batons are never shown
    // under a new unit; the 60s same-unit re-poll keeps the last response
    // visible (anti-flicker) through fetchOnce below.
    setData(null);
    setError(null);
    setLoading(true);

    const fetchOnce = async () => {
      try {
        const res = await api.unitHandoffs(unit);
        if (myGen !== generationRef.current) return;
        setData(res);
        setError(null);
      } catch (e) {
        if (myGen !== generationRef.current) return;
        setError(e instanceof Error ? e : new Error(String(e)));
      } finally {
        if (myGen === generationRef.current) {
          setLoading(false);
        }
      }
    };

    void fetchOnce();
    const id = window.setInterval(() => {
      void fetchOnce();
    }, POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(id);
    };
  }, [unit]);

  return { data, loading, error };
}

export interface UseHandoffContentResult {
  data: HandoffContentResponse | null;
  loading: boolean;
  error: Error | null;
}

/**
 * One-shot fetch of a single baton's raw markdown. Fetches once when both
 * `unit` and `name` are non-null (an explicit row click drives the
 * selection — the viewer never auto-opens), re-fetches on a baton change,
 * and parks (no fetch) when EITHER arg is null.
 *
 * Mirrors `usePrDetail`'s `usePrResource`: a generation guard so a stale
 * in-flight response from a previously selected baton never stamps over the
 * current one, and the previous payload is cleared synchronously on change
 * so a stale baton is never shown.
 */
export function useHandoffContent(
  unit: string | null,
  name: string | null,
): UseHandoffContentResult {
  const [data, setData] = useState<HandoffContentResponse | null>(null);
  const [loading, setLoading] = useState(unit !== null && name !== null);
  const [error, setError] = useState<Error | null>(null);
  const generationRef = useRef(0);

  // The stable identity of the request; the effect re-runs only when it
  // changes. `null` exactly when either arg is null, which parks the hook.
  const depKey = unit !== null && name !== null ? `${unit}/${name}` : null;

  useEffect(() => {
    if (depKey === null) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
    const myGen = ++generationRef.current;
    setData(null);
    setError(null);
    setLoading(true);
    void (async () => {
      try {
        // depKey is non-null exactly when both args are, so they are
        // concrete here.
        const res = await api.unitHandoff(unit as string, name as string);
        if (myGen !== generationRef.current) return;
        setData(res);
        setError(null);
      } catch (e) {
        if (myGen !== generationRef.current) return;
        setError(e instanceof Error ? e : new Error(String(e)));
      } finally {
        if (myGen === generationRef.current) setLoading(false);
      }
    })();
  }, [depKey, unit, name]);

  return { data, loading, error };
}
