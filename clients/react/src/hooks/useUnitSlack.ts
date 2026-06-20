// Polling hook for the unit's SLACK tab — the per-repo slack-ore terrain
// (`GET /api/units/{unit}/slack`, tmai-core
// `doc/slack/2026-06-11-230025-2.md` (recoil-loop-handoff) §6b–6d):
// pre-crystallization aim ore grouped per repo (primary first), each ore
// carrying its capture ticket, verbatim body, and the edge-derived
// `quoted_by` slugs.
//
// Ores change on the timescale the operator captures one — human-paced. A
// 60-second poll (same cadence as `useUnitPrs` / `useUnitAims`) is ample for
// a terrain surface; no SSE here. Keeps the previous response visible while
// a re-fetch is in flight so the terrain does not flicker; `loading`
// reflects only the initial fetch. `refresh` re-fetches the persisted state
// after a successful capture POST instead of waiting on the next poll tick.
//
// `unit = null` parks the hook (no fetch, no interval).

import { api, type UnitSlackResponse } from "@/lib/api";
import { usePolledResource } from "./usePolledResource";

const POLL_INTERVAL_MS = 60_000;

export interface UseUnitSlackResult {
  data: UnitSlackResponse | null;
  loading: boolean;
  error: Error | null;
  /**
   * Imperatively re-fetch the current unit's ores, keeping the previous
   * response visible while in flight (anti-flicker, same as the 60s poll). A
   * no-op when the hook is parked (`unit = null`). The capture box uses this
   * so a successful POST reflects the persisted ore immediately.
   */
  refresh: () => void;
}

export function useUnitSlack(unit: string | null): UseUnitSlackResult {
  // Shared poll resource (exposes `refresh`): the generation guard drops a
  // stale-unit response AND a response that resolves after unmount.
  return usePolledResource(unit, () => api.unitSlack(unit as string), {
    intervalMs: POLL_INTERVAL_MS,
  });
}
