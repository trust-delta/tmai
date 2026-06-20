// Polling hook for the unit's producer-feed status — the mechanical
// delta-gate the operator "Check deltas ▸" button reads.
//
// Per the 2026-05-26 producer-feed amendment §wire, the gate
// (`has_pending_delta = tip > last_served_cursor`) moves on the
// timescale of worker activity landing on the unit's feed. A 60-second
// poll matches the calibration sibling and is plenty for a manual
// operator affordance; we deliberately do not wire SSE here yet.
//
// Keeps the previous response visible while a re-fetch is in flight
// (`loading` reflects only the initial fetch) so the button's pending-state
// badge does not flicker between renders.
//
// `unit = null` parks the hook: no fetch, no interval, no data.

import { api, type ProducerFeedStatus } from "@/lib/api";
import { usePolledResource } from "./usePolledResource";

const POLL_INTERVAL_MS = 60_000;

export interface UseProducerFeedResult {
  data: ProducerFeedStatus | null;
  loading: boolean;
  error: Error | null;
}

export function useProducerFeed(unit: string | null): UseProducerFeedResult {
  // Shared poll resource: the generation guard drops a stale-unit response
  // AND a response that resolves after unmount. See usePolledResource.
  return usePolledResource(unit, () => api.producerFeed(unit as string), {
    intervalMs: POLL_INTERVAL_MS,
  });
}
