// Polling hook for the live Producer-slot set (tmai-core #580 — aim
// `producer-cwd`), the agent-primacy tab source for the aim console.
//
// `GET /api/slots` reflects only LIVE Producer slots — a project is *where a
// Producer stood*, not a configured `[[unit]]` enumeration. Each slot carries
// the same `name + repos` membership as `GET /api/units` plus a lifecycle
// `state` (`occupied` healthy / `vacant` mid-respawn / `halted` crash-loop;
// `closed` never surfaces). Where `useUnits` is the dormant-aware CONFIGURED
// membership (and stays the source for agent→unit resolution + the legacy
// unit-tab strip), this is the LIVE set the aim-console tabs read: a dormant
// `[[unit]]` that has never launched a Producer is not a tab until its "+"
// Add-unit launch stands one.
//
// Unlike the human-paced `useUnits` (config.toml edits, 60-second poll), slots
// are live state — a Producer launch / crash / handoff changes the set — so a
// shorter 10-second poll keeps a freshly-launched unit's tab appearing
// promptly. The previous response stays visible during a re-fetch so the tab
// strip does not flicker; `loading` reflects only the initial fetch.

import { useEffect, useState } from "react";
import { api, type SlotsResponse } from "@/lib/api";

const POLL_INTERVAL_MS = 10_000;

export interface UseSlotsResult {
  data: SlotsResponse | null;
  loading: boolean;
  error: Error | null;
}

export function useSlots(): UseSlotsResult {
  const [data, setData] = useState<SlotsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    // One global live-slot list — no unit-scope discriminator that could swap
    // mid-flight, so (like `useUnits`) the per-unit generation guard the
    // unit-scoped hooks use isn't needed here.
    let cancelled = false;

    const fetchOnce = async () => {
      try {
        const res = await api.slots();
        if (cancelled) return;
        setData(res);
        setError(null);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e : new Error(String(e)));
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void fetchOnce();
    const id = window.setInterval(() => {
      void fetchOnce();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return { data, loading, error };
}
