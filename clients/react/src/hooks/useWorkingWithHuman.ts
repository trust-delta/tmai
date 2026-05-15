// Polling hook for the unit's `◐ Working with this human` view.
//
// Mirrors `useDecisions` / `useCalibration`: 60s poll, parked when
// `unit` is null, generation guard against in-flight stamping. The
// memory directory + `MEMORY.md` change on human timescales (operators
// editing memory entries occasionally); polling is fine. SSE follow-up
// (`CoreEvent::MemoryChanged`) would be the natural next step.

import { useEffect, useRef, useState } from "react";
import { api, type WorkingWithHumanResponse } from "@/lib/api";

const POLL_INTERVAL_MS = 60_000;

export interface UseWorkingWithHumanResult {
  data: WorkingWithHumanResponse | null;
  loading: boolean;
  error: Error | null;
}

/**
 * Poll the unit's working-with-human view at `POLL_INTERVAL_MS`.
 * Returns the latest response, an initial-load `loading` flag, and the
 * most recent error (cleared on a successful fetch).
 *
 * `unit = null` parks the hook: no fetch, no interval. The section
 * then renders a "pick a project" notice rather than thrashing the
 * server on a non-existent unit.
 */
export function useWorkingWithHuman(unit: string | null): UseWorkingWithHumanResult {
  const [data, setData] = useState<WorkingWithHumanResponse | null>(null);
  const [loading, setLoading] = useState(unit !== null);
  const [error, setError] = useState<Error | null>(null);
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
        const res = await api.workingWithHuman(unit);
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
