// Polling hook for the unit's `▣ Active approaches` view (tmai-core
// PR #369) — the data behind the Producer console's Verdict-inbox.
//
// Approaches change on the timescale a Producer raises/closes an
// experiment — rare, human-paced. A 60-second poll (same cadence as
// `useCalibration`) is ample; no SSE here yet (the next session-start
// compose cleans up any tail). Keeps the previous response visible while a
// re-fetch is in flight so the inbox does not flicker; `loading` reflects
// only the initial fetch.
//
// `unit = null` parks the hook (no fetch, no interval) — used when no
// project is selected so the section can render a placeholder rather
// than poll a non-existent unit.

import { type ApproachesResponse, api } from "@/lib/api";
import { usePolledResource } from "./usePolledResource";

const POLL_INTERVAL_MS = 60_000;

export interface UseApproachesResult {
  data: ApproachesResponse | null;
  loading: boolean;
  error: Error | null;
}

export function useApproaches(unit: string | null): UseApproachesResult {
  // Shared poll resource: the generation guard drops a stale-unit response
  // AND a response that resolves after unmount (no setState on a gone
  // component). See usePolledResource. `unit` is the depKey, so the fetcher
  // only runs while it is non-null.
  return usePolledResource(unit, () => api.approaches(unit as string), {
    intervalMs: POLL_INTERVAL_MS,
  });
}
