// Polling hook for the unit's `🔀 Open PRs` view — the unified
// cross-repo PR list behind the Producer console's Stage-1 dev-loop
// (DR `2026-05-16-dev-loop-completes-in-tmai.md` §A, wire = tmai-core
// PR #389). One unit-scoped list across every repo in the unit; the
// section renders it flat, not a per-repo switcher.
//
// A 60-second poll is ample for an operator-review surface; no SSE here yet
// (the next session-start compose cleans up any tail). Keeps the previous
// response visible while a re-fetch is in flight so the list does not
// flicker; `loading` reflects only the initial fetch.
//
// `unit = null` parks the hook (no fetch, no interval).

import { api, type UnitPrsResponse } from "@/lib/api";
import { usePolledResource } from "./usePolledResource";

const POLL_INTERVAL_MS = 60_000;

export interface UseUnitPrsResult {
  data: UnitPrsResponse | null;
  loading: boolean;
  error: Error | null;
}

export function useUnitPrs(unit: string | null): UseUnitPrsResult {
  // Shared poll resource: the generation guard drops a stale-unit response
  // AND a response that resolves after unmount. See usePolledResource.
  return usePolledResource(unit, () => api.unitPrs(unit as string), {
    intervalMs: POLL_INTERVAL_MS,
  });
}
