// Polling hook for the unit's aim-tree view (R panel's ◎ Aims section),
// consuming `GET /api/units/{unit}/aims` (tmai-core #500): every aim record
// in each repo's `docs/aims/`, carrying the full node (`slug` / `aim` /
// `parent` / `state` / `depends_on` / `serves` / `related` / `body`).
//
// The aim-tree twin of `useApproaches` — same shape,
// same cadence. Aims change on the timescale an operator edits an anchor or
// a Producer files a node — rare, human-paced. A 60-second poll is ample for
// an operator-scan surface; no SSE here yet. Keeps the previous response
// visible while a re-fetch is in flight so the tree does not flicker;
// `loading` reflects only the initial fetch. `refresh` reflects an operator
// write (create / edit) immediately instead of waiting on the next tick.
//
// `unit = null` parks the hook (no fetch, no interval).

import { type AimsResponse, api } from "@/lib/api";
import { usePolledResource } from "./usePolledResource";

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
  // Shared poll resource (exposes `refresh`): the generation guard drops a
  // stale-unit response AND a response that resolves after unmount.
  return usePolledResource(unit, () => api.aims(unit as string), {
    intervalMs: POLL_INTERVAL_MS,
  });
}
