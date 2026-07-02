// Polling hook for the live Producer-slot set (tmai-core #580 — aim
// `producer-cwd`), the agent-primacy tab source for the aim console.
//
// `GET /api/slots` reflects only LIVE Producer slots — a project is *where a
// Producer stood*, not a configured `[[unit]]` enumeration. Each slot carries
// its `name + repos` membership (unit ≡ live Producer: a slot is just presence
// — there is no lifecycle state, the homeostatic slot invariant was retired).
// Since the config-unit rip (tmai-core #623) retired the dormant-aware
// configured-unit enumeration (`/units`), this is the SOLE membership surface:
// it drives the aim-console tabs, the active agent→unit resolution, and the
// cross-unit digest. A dormant `[[unit]]` that has never launched a Producer is
// not a tab until its "+" Add-unit launch stands one.
//
// Slots are live state — a Producer launch / crash / handoff changes the set —
// so a short 10-second poll keeps a freshly-launched unit's tab appearing
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
    // mid-flight, so the per-unit generation guard the unit-scoped hooks use
    // isn't needed here.
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
