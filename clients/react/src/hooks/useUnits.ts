// Polling hook for the configured-unit membership view (tmai-core
// #460, public types mirror tmai#741) — the wire half of #439.
//
// `GET /api/units` returns the engine's configured `[[unit]]`
// membership (one entry per unit, each carrying its `repos[]` with the
// `primary` flag). It is the only **dormant-unit-aware** surface: the
// live-agent derivation in `groupByProject` only sees units that have
// at least one live agent, so reconciling against this list is what
// lets `useHandover` surface configured-but-quiet units in the cross-
// unit status section with state `quiet`.
//
// Membership is human-paced (operator edits config.toml) so a 60-second
// poll (same cadence as the sibling unit-scoped wires) is ample; we keep
// the previous response visible while a re-fetch is in flight so the
// reconciled list does not flicker. `loading` reflects only the
// initial fetch, mirroring `useCalibration` / `useUnitPrs` / `useApproaches`.

import { useEffect, useState } from "react";
import { api, type UnitsResponse } from "@/lib/api";

const POLL_INTERVAL_MS = 60_000;

export interface UseUnitsResult {
  data: UnitsResponse | null;
  loading: boolean;
  error: Error | null;
}

export function useUnits(): UseUnitsResult {
  const [data, setData] = useState<UnitsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    // Unlike the sibling unit-scoped hooks (`useCalibration`,
    // `useUnitPrs`, `useApproaches`), this endpoint has no unit-scope
    // discriminator that could swap mid-flight — there is one global
    // membership list. So the generation guard those hooks use to drop
    // stale responses against a newer unit isn't required here.
    let cancelled = false;

    const fetchOnce = async () => {
      try {
        const res = await api.units();
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
