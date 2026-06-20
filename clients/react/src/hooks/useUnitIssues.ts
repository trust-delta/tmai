// Polling hook for the unit's `📋 Issues` view — the unified cross-repo
// open-issue list behind the Producer console's R panel (approach
// `2026-05-29-r-panel-as-project-artifact-inventory.md`, served by
// tmai-core `GET /api/units/{unit}/issues`). One unit-scoped list across
// every repo in the unit; the section renders it grouped by repo, not as a
// per-repo switcher.
//
// The issues twin of `useUnitPrs` — same shape, same cadence. A 60-second
// poll is ample for an operator-review surface; no SSE here yet. Keeps the
// previous response visible while a re-fetch is in flight so the list does
// not flicker; `loading` reflects only the initial fetch.
//
// `unit = null` parks the hook (no fetch, no interval).

import { api, type UnitIssuesResponse } from "@/lib/api";
import { usePolledResource } from "./usePolledResource";

const POLL_INTERVAL_MS = 60_000;

export interface UseUnitIssuesResult {
  data: UnitIssuesResponse | null;
  loading: boolean;
  error: Error | null;
}

export function useUnitIssues(unit: string | null): UseUnitIssuesResult {
  // Shared poll resource: the generation guard drops a stale-unit response
  // AND a response that resolves after unmount. See usePolledResource.
  return usePolledResource(unit, () => api.unitIssues(unit as string), {
    intervalMs: POLL_INTERVAL_MS,
  });
}
