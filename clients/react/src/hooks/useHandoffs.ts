// Fetch hooks for the R₂ in-tmai Hand-over viewer — the operator-side half
// of tmai-core PR #473's handoffs endpoint.
//
// `useHandoffs(unit)` is the LIST hook (mirrors `useDecisions`): a 60-second
// poll over the unit's baton inventory (active first, then archived
// newest-first — the wire order). Batons change only when a hand-over ritual
// completes (minutes to hours), so a 60s poll is plenty; SSE is a deferred
// follow-up. A `null` unit parks the hook (no fetch, no interval).
//
// `useHandoffContent(unit, name)` is the one-shot CONTENT hook: it fetches a
// single baton's raw markdown only after an explicit operator click on a
// row, with a generation guard so a stale in-flight response from a
// previously selected baton never stamps over the current one. It parks when
// EITHER arg is null.

import { api, type HandoffContentResponse, type HandoffsResponse } from "@/lib/api";
import { usePolledResource } from "./usePolledResource";

const POLL_INTERVAL_MS = 60_000;

export interface UseHandoffsResult {
  data: HandoffsResponse | null;
  loading: boolean;
  error: Error | null;
}

/**
 * Poll the unit's hand-over baton list at `POLL_INTERVAL_MS`. `unit = null`
 * parks the hook (no fetch, no interval). The generation guard drops a
 * stale-unit response AND a response that resolves after unmount.
 */
export function useHandoffs(unit: string | null): UseHandoffsResult {
  return usePolledResource(unit, () => api.unitHandoffs(unit as string), {
    intervalMs: POLL_INTERVAL_MS,
  });
}

export interface UseHandoffContentResult {
  data: HandoffContentResponse | null;
  loading: boolean;
  error: Error | null;
}

/**
 * One-shot fetch of a single baton's raw markdown. Fetches once when both
 * `unit` and `name` are non-null (an explicit row click drives the
 * selection — the viewer never auto-opens), re-fetches on a baton change,
 * and parks (no fetch) when EITHER arg is null. The generation guard drops a
 * stale selection's response AND a response that resolves after unmount.
 */
export function useHandoffContent(
  unit: string | null,
  name: string | null,
): UseHandoffContentResult {
  // depKey is non-null exactly when both args are, which parks otherwise.
  const depKey = unit !== null && name !== null ? `${unit}/${name}` : null;
  return usePolledResource(depKey, () => api.unitHandoff(unit as string, name as string));
}
