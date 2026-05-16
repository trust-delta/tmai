// Polling hook for the unit's `🔀 Open PRs` view — the unified
// cross-repo PR list behind the Producer console's Stage-1 dev-loop
// (DR `2026-05-16-dev-loop-completes-in-tmai.md` §A, wire = tmai-core
// PR #389). One unit-scoped list across every repo in the unit; the
// section renders it flat, not a per-repo switcher.
//
// PRs change on the timescale a worker pushes / a review lands —
// minutes typically. A 60-second poll (same cadence as `useApproaches`
// / `useCalibration`) is ample for an operator-review surface; no SSE
// here yet (the next session-start compose cleans up any tail). Mirrors
// the siblings' shape exactly: keeps the previous response visible
// while a re-fetch is in flight so the list does not flicker; `loading`
// reflects only the initial fetch.
//
// `unit = null` parks the hook (no fetch, no interval) — used when no
// project is selected so the section can render a placeholder rather
// than poll a non-existent unit.

import { useEffect, useRef, useState } from "react";
import { api, type UnitPrsResponse } from "@/lib/api";

const POLL_INTERVAL_MS = 60_000;

export interface UseUnitPrsResult {
  data: UnitPrsResponse | null;
  loading: boolean;
  error: Error | null;
}

export function useUnitPrs(unit: string | null): UseUnitPrsResult {
  const [data, setData] = useState<UnitPrsResponse | null>(null);
  const [loading, setLoading] = useState(unit !== null);
  const [error, setError] = useState<Error | null>(null);
  // An in-flight response from a previous unit must not stamp over a
  // newer unit's data (same guard as useApproaches / useCalibration).
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
    // [unit]) so the previous unit's PR list is never shown under the
    // new unit's header. The 60s same-unit re-poll goes through
    // fetchOnce, which intentionally keeps the last response visible
    // (anti-flicker); that path is untouched. Mirrors the same guard in
    // useApproaches; transparency-over-completeness per
    // doc/decisions/2026-05-14-webui-simulated-onboarded-posture.md.
    setData(null);
    setError(null);
    setLoading(true);

    const fetchOnce = async () => {
      try {
        const res = await api.unitPrs(unit);
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
