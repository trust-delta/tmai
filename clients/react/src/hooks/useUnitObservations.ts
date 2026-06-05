// Polling hook for the unit's observations view (R panel's ◇ section) —
// the cross-repo "what did we notice" salvage surface, consuming
// `GET /api/units/{unit}/observations` (tmai-core #498): every observation
// record in each repo's `doc/observations/`, carrying only the row fields
// (`slug` / `summary` / `status`).
//
// The observations twin of `useApproaches` / `useUnitInventory` — same shape,
// same cadence. Observations change on the timescale a Producer files a note
// — rare, human-paced. A 60-second poll (same cadence as the siblings) is
// ample for an operator-scan surface; no SSE here yet. Mirrors the siblings'
// shape exactly: keeps the previous response visible while a re-fetch is in
// flight so the list does not flicker; `loading` reflects only the initial
// fetch.
//
// `unit = null` parks the hook (no fetch, no interval) — used when no project
// is selected so the section can render a placeholder rather than poll a
// non-existent unit.

import { useEffect, useRef, useState } from "react";
import { api, type ObservationsResponse } from "@/lib/api";

const POLL_INTERVAL_MS = 60_000;

export interface UseUnitObservationsResult {
  data: ObservationsResponse | null;
  loading: boolean;
  error: Error | null;
}

export function useUnitObservations(unit: string | null): UseUnitObservationsResult {
  const [data, setData] = useState<ObservationsResponse | null>(null);
  const [loading, setLoading] = useState(unit !== null);
  const [error, setError] = useState<Error | null>(null);
  // An in-flight response from a previous unit must not stamp over a
  // newer unit's data (same guard as useApproaches / useUnitInventory).
  const generationRef = useRef(0);

  useEffect(() => {
    if (!unit) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
    const myGen = ++generationRef.current;
    // Clear on unit *change* (this effect's only re-trigger — deps are
    // [unit]) so the previous unit's observations are never shown under the
    // new unit's header. The 60s same-unit re-poll goes through fetchOnce,
    // which intentionally keeps the last response visible (anti-flicker);
    // that path is untouched. Mirrors the guard in useApproaches.
    setData(null);
    setError(null);
    setLoading(true);

    const fetchOnce = async () => {
      try {
        const res = await api.observations(unit);
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
