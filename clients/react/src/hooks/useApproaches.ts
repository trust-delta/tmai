// Polling hook for the unit's `▣ Active approaches` view (tmai-core
// PR #369) — the data behind the Producer console's Verdict-inbox.
//
// Approaches change on the timescale a Producer raises/closes an
// experiment — rare, human-paced. A 60-second poll (same cadence as
// `useCalibration`) is ample; no SSE here yet (the next session-start
// compose cleans up any tail). Mirrors `useCalibration`'s shape: keeps
// the previous response visible while a re-fetch is in flight so the
// inbox does not flicker; `loading` reflects only the initial fetch.
//
// `unit = null` parks the hook (no fetch, no interval) — used when no
// project is selected so the section can render a placeholder rather
// than poll a non-existent unit.

import { useEffect, useRef, useState } from "react";
import { type ApproachesResponse, api } from "@/lib/api";

const POLL_INTERVAL_MS = 60_000;

export interface UseApproachesResult {
  data: ApproachesResponse | null;
  loading: boolean;
  error: Error | null;
}

export function useApproaches(unit: string | null): UseApproachesResult {
  const [data, setData] = useState<ApproachesResponse | null>(null);
  const [loading, setLoading] = useState(unit !== null);
  const [error, setError] = useState<Error | null>(null);
  // An in-flight response from a previous unit must not stamp over a
  // newer unit's data (same guard as useCalibration).
  const generationRef = useRef(0);

  useEffect(() => {
    if (!unit) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
    const myGen = ++generationRef.current;
    setLoading(true);

    const fetchOnce = async () => {
      try {
        const res = await api.approaches(unit);
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
