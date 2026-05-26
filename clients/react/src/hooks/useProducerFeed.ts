// Polling hook for the unit's producer-feed status — the mechanical
// delta-gate the operator "Check deltas ▸" button reads.
//
// Per the 2026-05-26 producer-feed amendment §wire, the gate
// (`has_pending_delta = tip > last_served_cursor`) moves on the
// timescale of worker activity landing on the unit's feed. A 60-second
// poll matches the calibration sibling and is plenty for a manual
// operator affordance; we deliberately do not wire SSE here yet (the
// button does not need real-time precision, the cache miss on the next
// session start cleans up any tail).
//
// The hook keeps the previous response visible while a re-fetch is in
// flight (`loading` reflects only the initial fetch) so the button's
// pending-state badge does not flicker between renders.

import { useEffect, useRef, useState } from "react";
import { api, type ProducerFeedStatus } from "@/lib/api";

const POLL_INTERVAL_MS = 60_000;

export interface UseProducerFeedResult {
  data: ProducerFeedStatus | null;
  loading: boolean;
  error: Error | null;
}

/**
 * Poll the unit's producer-feed status at `POLL_INTERVAL_MS`. Returns
 * the latest response, an initial-load `loading` flag, and the most
 * recent error (cleared on a successful fetch).
 *
 * `unit = null` parks the hook: no fetch, no interval, no data. Useful
 * when the UI has no project selected and we want the delta-check
 * button to sit dormant rather than poll a non-existent unit.
 */
export function useProducerFeed(unit: string | null): UseProducerFeedResult {
  const [data, setData] = useState<ProducerFeedStatus | null>(null);
  const [loading, setLoading] = useState(unit !== null);
  const [error, setError] = useState<Error | null>(null);
  // Track the latest fetch so an in-flight response from a previous unit
  // cannot stamp over a newer unit's data.
  const generationRef = useRef(0);

  useEffect(() => {
    if (!unit) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
    const myGen = ++generationRef.current;
    // Clear on unit *change* (this effect's only re-trigger — dep is
    // [unit]) so a previous query's pending-badge is never shown under a
    // new unit's context. The 60s same-query re-poll goes through
    // fetchOnce, which intentionally keeps the last response visible
    // (anti-flicker); that path is untouched. Mirrors the same guard in
    // useCalibration / useApproaches.
    setData(null);
    setError(null);
    setLoading(true);

    const fetchOnce = async () => {
      try {
        const res = await api.producerFeed(unit);
        if (myGen !== generationRef.current) return;
        setData(res);
        setError(null);
      } catch (e) {
        if (myGen !== generationRef.current) return;
        setError(e instanceof Error ? e : new Error(String(e)));
      } finally {
        if (myGen === generationRef.current) {
          setLoading(false);
        }
      }
    };

    void fetchOnce();
    const id = window.setInterval(() => {
      void fetchOnce();
    }, POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(id);
    };
  }, [unit]);

  return { data, loading, error };
}
