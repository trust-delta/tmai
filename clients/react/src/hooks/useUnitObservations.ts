// Polling hook for the unit's observations view (R panel's ◇ section) —
// the cross-repo "what did we notice" salvage surface, consuming
// `GET /api/units/{unit}/observations` (tmai-core #498): every observation
// record in each repo's `doc/observations/`, carrying only the row fields
// (`slug` / `summary` / `status`).
//
// The observations twin of `useApproaches` / `useUnitInventory` — same
// shape, same cadence. A 60-second poll is ample for an operator-scan
// surface; no SSE here yet. Keeps the previous response visible while a
// re-fetch is in flight so the list does not flicker; `loading` reflects
// only the initial fetch.
//
// `unit = null` parks the hook (no fetch, no interval).

import { api, type ObservationsResponse } from "@/lib/api";
import { usePolledResource } from "./usePolledResource";

const POLL_INTERVAL_MS = 60_000;

export interface UseUnitObservationsResult {
  data: ObservationsResponse | null;
  loading: boolean;
  error: Error | null;
}

export function useUnitObservations(unit: string | null): UseUnitObservationsResult {
  // Shared poll resource: the generation guard drops a stale-unit response
  // AND a response that resolves after unmount. See usePolledResource.
  return usePolledResource(unit, () => api.observations(unit as string), {
    intervalMs: POLL_INTERVAL_MS,
  });
}
