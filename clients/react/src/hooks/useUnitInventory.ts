// Polling hook for the unit's in-play inventory (R₁) — the cross-record
// "what's in-play / what's outstanding" projection behind the R panel's
// in-play section, consuming `GET /api/units/{unit}/inventory` (the
// projection wire from tmai-core #485/#486): every decision with its
// serving approaches nested, plus the unanchored approaches, each carrying
// its fact-projected status / work-residual / liveness.
//
// The inventory twin of `useUnitIssues` / `useApproaches` — same shape,
// same cadence. A 60-second poll is ample for an operator-review surface;
// no SSE here yet. Keeps the previous response visible while a re-fetch is
// in flight so the list does not flicker; `loading` reflects only the
// initial fetch.
//
// `unit = null` parks the hook (no fetch, no interval).

import { api, type UnitInventoryResponse } from "@/lib/api";
import { usePolledResource } from "./usePolledResource";

const POLL_INTERVAL_MS = 60_000;

export interface UseUnitInventoryResult {
  data: UnitInventoryResponse | null;
  loading: boolean;
  error: Error | null;
}

export function useUnitInventory(unit: string | null): UseUnitInventoryResult {
  // Shared poll resource: the generation guard drops a stale-unit response
  // AND a response that resolves after unmount. See usePolledResource.
  return usePolledResource(unit, () => api.unitInventory(unit as string), {
    intervalMs: POLL_INTERVAL_MS,
  });
}
