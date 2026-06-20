// Polling hook for the unit's calibration view + tier-1 tripwire list.
//
// Per `doc/decisions/2026-05-13-synthesis-processing-and-calibration-schema.md`
// §B.3 / §B.4, calibration data changes on the timescale of a synthesis
// pass — minutes at the fastest, hours typically. A 60-second poll is
// plenty for the WebUI top-bar tripwire indicator and the drill-down panel;
// we deliberately do not wire SSE here yet.
//
// Keeps the previous response visible while a re-fetch is in flight
// (`loading` reflects only the initial fetch) so the tripwire chip does not
// flicker between renders.
//
// `unit = null` parks the hook: no fetch, no interval, no data.

import { api, type CalibrationResponse } from "@/lib/api";
import { usePolledResource } from "./usePolledResource";

const POLL_INTERVAL_MS = 60_000;

export interface UseCalibrationResult {
  data: CalibrationResponse | null;
  loading: boolean;
  error: Error | null;
}

export function useCalibration(unit: string | null, days = 90): UseCalibrationResult {
  // `days` is part of the request identity, so it joins the depKey — a days
  // change re-fetches just like a unit change. The generation guard drops a
  // stale response (prior unit/days) AND a response resolving after unmount.
  const depKey = unit !== null ? `${unit}#${days}` : null;
  return usePolledResource(depKey, () => api.calibration(unit as string, days), {
    intervalMs: POLL_INTERVAL_MS,
  });
}
