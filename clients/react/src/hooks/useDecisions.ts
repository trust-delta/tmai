// Polling hook for the unit's settled-decisions view.
//
// Mirrors `useCalibration`: a 60-second poll is plenty for the
// `⬡ Settled decisions` section since decision frontmatter and git
// history move on human timescales, not real-time. SSE-driven updates
// would be the natural follow-up (`CoreEvent::DecisionsChanged` on the
// tmai-core side) but the polling shape lets us land the UX without
// blocking on that wire-side work.
//
// Keeps the previous response visible while a re-fetch is in flight
// (`loading` reflects only the initial fetch) so the bucketed render does
// not flash empty between renders.
//
// `unit = null` parks the hook: no fetch, no interval, no data.

import { api, type DecisionsResponse } from "@/lib/api";
import { usePolledResource } from "./usePolledResource";

const POLL_INTERVAL_MS = 60_000;

export interface UseDecisionsResult {
  data: DecisionsResponse | null;
  loading: boolean;
  error: Error | null;
}

export function useDecisions(unit: string | null): UseDecisionsResult {
  // Shared poll resource: the generation guard drops a stale-unit response
  // AND a response that resolves after unmount. See usePolledResource.
  return usePolledResource(unit, () => api.decisions(unit as string), {
    intervalMs: POLL_INTERVAL_MS,
  });
}
