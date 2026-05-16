// Polling hook for the unit's calibration view + tier-1 tripwire list.
//
// Per `doc/decisions/2026-05-13-synthesis-processing-and-calibration-schema.md`
// §B.3 / §B.4, calibration data changes on the timescale of a synthesis
// pass — minutes at the fastest, hours typically. A 60-second poll is
// plenty for the WebUI top-bar tripwire indicator and the drill-down
// panel; we deliberately do not wire SSE here yet (the indicator does
// not need real-time precision, the cache miss on the next session
// start cleans up any tail).
//
// The hook keeps the previous response visible while a re-fetch is in
// flight (`loading` reflects only the initial fetch) so the tripwire
// chip does not flicker between renders.

import { useEffect, useRef, useState } from "react";
import { api, type CalibrationResponse } from "@/lib/api";

const POLL_INTERVAL_MS = 60_000;

export interface UseCalibrationResult {
  data: CalibrationResponse | null;
  loading: boolean;
  error: Error | null;
}

/**
 * Poll the unit's calibration view at `POLL_INTERVAL_MS`. Returns the
 * latest response, an initial-load `loading` flag, and the most recent
 * error (cleared on a successful fetch).
 *
 * `unit = null` parks the hook: no fetch, no interval, no data. Useful
 * when the UI has no project selected and we want the chip / banner to
 * sit dormant rather than poll a non-existent unit.
 */
export function useCalibration(unit: string | null, days = 90): UseCalibrationResult {
  const [data, setData] = useState<CalibrationResponse | null>(null);
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
    // Clear on unit/days *change* (this effect's only re-triggers — deps
    // are [unit, days]) so a previous query's tripwire/chip is never
    // shown under a new unit's context. The 60s same-query re-poll goes
    // through fetchOnce, which intentionally keeps the last response
    // visible (anti-flicker); that path is untouched. Mirrors the same
    // guard in useApproaches; transparency-over-completeness per
    // doc/decisions/2026-05-14-webui-simulated-onboarded-posture.md.
    setData(null);
    setError(null);
    setLoading(true);

    const fetchOnce = async () => {
      try {
        const res = await api.calibration(unit, days);
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
  }, [unit, days]);

  return { data, loading, error };
}
