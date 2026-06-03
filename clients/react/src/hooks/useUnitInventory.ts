// Polling hook for the unit's in-play inventory (R₁) — the cross-record
// "what's in-play / what's outstanding" projection behind the R panel's
// in-play section, consuming `GET /api/units/{unit}/inventory` (the
// projection wire from tmai-core #485/#486): every decision with its
// serving approaches nested, plus the unanchored approaches, each carrying
// its fact-projected status / work-residual / liveness.
//
// The inventory twin of `useUnitIssues` / `useApproaches` — same shape,
// same cadence. The inventory tracks records + their fact-logs, which move
// on the timescale a Producer raises/closes an approach or files a fact —
// human-paced. A 60-second poll (same cadence as the siblings) is ample
// for an operator-review surface; no SSE here yet. Mirrors the siblings'
// shape exactly: keeps the previous response visible while a re-fetch is in
// flight so the list does not flicker; `loading` reflects only the initial
// fetch.
//
// `unit = null` parks the hook (no fetch, no interval) — used when no
// project is selected so the section can render a placeholder rather than
// poll a non-existent unit.

import { useEffect, useRef, useState } from "react";
import { api, type UnitInventoryResponse } from "@/lib/api";

const POLL_INTERVAL_MS = 60_000;

export interface UseUnitInventoryResult {
  data: UnitInventoryResponse | null;
  loading: boolean;
  error: Error | null;
}

export function useUnitInventory(unit: string | null): UseUnitInventoryResult {
  const [data, setData] = useState<UnitInventoryResponse | null>(null);
  const [loading, setLoading] = useState(unit !== null);
  const [error, setError] = useState<Error | null>(null);
  // An in-flight response from a previous unit must not stamp over a
  // newer unit's data (same guard as useUnitIssues / useApproaches).
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
    // [unit]) so the previous unit's inventory is never shown under the new
    // unit's header. The 60s same-unit re-poll goes through fetchOnce,
    // which intentionally keeps the last response visible (anti-flicker);
    // that path is untouched. Mirrors the same guard in useUnitIssues.
    setData(null);
    setError(null);
    setLoading(true);

    const fetchOnce = async () => {
      try {
        const res = await api.unitInventory(unit);
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
