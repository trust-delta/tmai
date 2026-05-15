// Polling hook for the unit's settled-decisions view.
//
// Mirrors `useCalibration`: a 60-second poll is plenty for the
// `⬡ Settled decisions` section since decision frontmatter and git
// history move on human timescales, not real-time. SSE-driven updates
// would be the natural follow-up (`CoreEvent::DecisionsChanged` on the
// tmai-core side) but the polling shape lets us land the UX without
// blocking on that wire-side work.
//
// The hook keeps the previous response visible while a re-fetch is in
// flight (`loading` reflects only the initial fetch) so the bucketed
// render does not flash empty between renders.

import { useEffect, useRef, useState } from "react";
import { api, type DecisionsResponse } from "@/lib/api";

const POLL_INTERVAL_MS = 60_000;

export interface UseDecisionsResult {
  data: DecisionsResponse | null;
  loading: boolean;
  error: Error | null;
}

/**
 * Poll the unit's settled-decisions view at `POLL_INTERVAL_MS`. Returns
 * the latest response, an initial-load `loading` flag, and the most
 * recent error (cleared on a successful fetch).
 *
 * `unit = null` parks the hook: no fetch, no interval, no data. Useful
 * when the UI has no project selected and we want the section to render
 * its "no unit yet" placeholder rather than poll a non-existent unit.
 */
export function useDecisions(unit: string | null): UseDecisionsResult {
  const [data, setData] = useState<DecisionsResponse | null>(null);
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
    setLoading(true);

    const fetchOnce = async () => {
      try {
        const res = await api.decisions(unit);
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
