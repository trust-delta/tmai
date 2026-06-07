// Polling hook for the unit's aim-tree view (R panel's ◎ Aims section),
// consuming `GET /api/units/{unit}/aims` (tmai-core #500): every aim record
// in each repo's `doc/aims/`, carrying the full node (`slug` / `aim` /
// `parent` / `state` / `depends_on` / `serves` / `related` / `body`).
//
// The aim-tree twin of `useUnitObservations` / `useApproaches` — same shape,
// same cadence. Aims change on the timescale an operator edits an anchor or a
// Producer files a node — rare, human-paced. A 60-second poll (same cadence as
// the siblings) is ample for an operator-scan surface; no SSE here yet. Mirrors
// the siblings' shape exactly: keeps the previous response visible while a
// re-fetch is in flight so the tree does not flicker; `loading` reflects only
// the initial fetch.
//
// `unit = null` parks the hook (no fetch, no interval) — used when no project
// is selected so the section can render a placeholder rather than poll a
// non-existent unit.

import { useCallback, useEffect, useRef, useState } from "react";
import { type AimsResponse, api } from "@/lib/api";

const POLL_INTERVAL_MS = 60_000;

export interface UseUnitAimsResult {
  data: AimsResponse | null;
  loading: boolean;
  error: Error | null;
  /**
   * Imperatively re-fetch the current unit's aims, keeping the previous
   * response visible while in flight (anti-flicker, same as the 60s poll). A
   * no-op when the hook is parked (`unit = null`). Stage 2-B uses this so an
   * operator write (create / edit) reflects the persisted record immediately
   * instead of waiting on the next poll tick.
   */
  refresh: () => void;
}

export function useUnitAims(unit: string | null): UseUnitAimsResult {
  const [data, setData] = useState<AimsResponse | null>(null);
  const [loading, setLoading] = useState(unit !== null);
  const [error, setError] = useState<Error | null>(null);
  // An in-flight response from a previous unit must not stamp over a
  // newer unit's data (same guard as useUnitObservations / useApproaches).
  const generationRef = useRef(0);
  // The live unit, so the stable `refresh` callback re-fetches the *current*
  // unit without being re-created on every unit change.
  const unitRef = useRef(unit);
  unitRef.current = unit;

  // One gen-guarded fetch against `targetUnit`, keeping the previous response
  // visible (anti-flicker). Shared by the initial fetch, the 60s poll, and
  // `refresh`. Stable identity (no deps) so it doesn't re-trigger the effect.
  const fetchFor = useCallback(async (targetUnit: string, gen: number) => {
    try {
      const res = await api.aims(targetUnit);
      if (gen !== generationRef.current) return;
      setData(res);
      setError(null);
    } catch (e) {
      if (gen !== generationRef.current) return;
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      if (gen === generationRef.current) {
        setLoading(false);
      }
    }
  }, []);

  const refresh = useCallback(() => {
    const u = unitRef.current;
    if (!u) return;
    // Re-fetch under the CURRENT generation, no data clear — the poll path's
    // anti-flicker behaviour, triggered on demand after an operator write.
    void fetchFor(u, generationRef.current);
  }, [fetchFor]);

  useEffect(() => {
    if (!unit) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
    const myGen = ++generationRef.current;
    // Clear on unit *change* (this effect's only re-trigger — deps are
    // [unit]) so the previous unit's aims are never shown under the new
    // unit's header. The 60s same-unit re-poll and `refresh` go through
    // fetchFor, which intentionally keeps the last response visible
    // (anti-flicker); those paths are untouched. Mirrors useUnitObservations.
    setData(null);
    setError(null);
    setLoading(true);

    void fetchFor(unit, myGen);
    const id = window.setInterval(() => {
      void fetchFor(unit, myGen);
    }, POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(id);
    };
  }, [unit, fetchFor]);

  return { data, loading, error, refresh };
}
