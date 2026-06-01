// Polling hook for the unit's `📋 Issues` view — the unified cross-repo
// open-issue list behind the Producer console's R panel (approach
// `2026-05-29-r-panel-as-project-artifact-inventory.md`, which closes
// its "no unit-scoped issues endpoint exists yet" defer item now that
// tmai-core serves `GET /api/units/{unit}/issues`). One unit-scoped list
// across every repo in the unit; the section renders it grouped by repo,
// not as a per-repo switcher.
//
// The issues twin of `useUnitPrs` — same shape, same cadence. Issues
// change on the timescale a worker files / closes one — minutes
// typically. A 60-second poll (same cadence as `useUnitPrs` /
// `useApproaches` / `useCalibration`) is ample for an operator-review
// surface; no SSE here yet (the next session-start compose cleans up any
// tail). Mirrors the siblings' shape exactly: keeps the previous response
// visible while a re-fetch is in flight so the list does not flicker;
// `loading` reflects only the initial fetch.
//
// `unit = null` parks the hook (no fetch, no interval) — used when no
// project is selected so the section can render a placeholder rather
// than poll a non-existent unit.

import { useEffect, useRef, useState } from "react";
import { api, type UnitIssuesResponse } from "@/lib/api";

const POLL_INTERVAL_MS = 60_000;

export interface UseUnitIssuesResult {
  data: UnitIssuesResponse | null;
  loading: boolean;
  error: Error | null;
}

export function useUnitIssues(unit: string | null): UseUnitIssuesResult {
  const [data, setData] = useState<UnitIssuesResponse | null>(null);
  const [loading, setLoading] = useState(unit !== null);
  const [error, setError] = useState<Error | null>(null);
  // An in-flight response from a previous unit must not stamp over a
  // newer unit's data (same guard as useUnitPrs / useApproaches).
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
    // [unit]) so the previous unit's issue list is never shown under the
    // new unit's header. The 60s same-unit re-poll goes through
    // fetchOnce, which intentionally keeps the last response visible
    // (anti-flicker); that path is untouched. Mirrors the same guard in
    // useUnitPrs; transparency-over-completeness per
    // doc/decisions/2026-05-14-webui-simulated-onboarded-posture.md.
    setData(null);
    setError(null);
    setLoading(true);

    const fetchOnce = async () => {
      try {
        const res = await api.unitIssues(unit);
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
