// Polling hook for the unit's SLACK tab — the per-repo slack-ore terrain
// (`GET /api/units/{unit}/slack`, tmai-core
// `doc/slack/2026-06-11-230025-2.md` (recoil-loop-handoff) §6b–6d):
// pre-crystallization aim ore grouped per repo (primary first), each ore
// carrying its capture ticket, verbatim body, and the edge-derived
// `quoted_by` slugs.
//
// Ores change on the timescale the operator captures one — human-paced. A
// 60-second poll (same cadence as `useUnitPrs` / `useUnitAims`) is ample for
// a terrain surface; no SSE here. Mirrors the siblings' shape exactly: keeps
// the previous response visible while a re-fetch is in flight so the terrain
// does not flicker; `loading` reflects only the initial fetch. `refresh`
// follows `useUnitAims` — the capture box re-fetches the persisted state
// after a successful POST instead of waiting on the next poll tick.
//
// `unit = null` parks the hook (no fetch, no interval) — used when no
// project is selected so the face can render a placeholder rather than poll
// a non-existent unit.

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type UnitSlackResponse } from "@/lib/api";

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
  const [data, setData] = useState<UnitSlackResponse | null>(null);
  const [loading, setLoading] = useState(unit !== null);
  const [error, setError] = useState<Error | null>(null);
  // An in-flight response from a previous unit must not stamp over a
  // newer unit's data (same guard as useUnitPrs / useUnitAims).
  const generationRef = useRef(0);
  // The live unit, so the stable `refresh` callback re-fetches the *current*
  // unit without being re-created on every unit change.
  const unitRef = useRef(unit);
  unitRef.current = unit;

  // One gen-guarded fetch against `targetUnit`, keeping the previous response
  // visible (anti-flicker). Shared by the initial fetch, the 60s poll, and
  // `refresh`. Stable identity (no deps) so it doesn't re-trigger the effect.
  const fetchFor = useCallback(async (targetUnit: string, gen: number) => {
    try {
      const res = await api.unitSlack(targetUnit);
      if (gen !== generationRef.current) return;
      setData(res);
      setError(null);
    } catch (e) {
      if (gen !== generationRef.current) return;
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      if (gen === generationRef.current) {
        setLoading(false);
      }
    }
  }, []);

  const refresh = useCallback(() => {
    const u = unitRef.current;
    if (!u) return;
    // Re-fetch under the CURRENT generation, no data clear — the poll path's
    // anti-flicker behaviour, triggered on demand after an operator capture.
    void fetchFor(u, generationRef.current);
  }, [fetchFor]);

  useEffect(() => {
    if (!unit) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
    const myGen = ++generationRef.current;
    // Clear on unit *change* (this effect's only re-trigger — deps are
    // [unit]) so the previous unit's ores are never shown under the new
    // unit's header. The 60s same-unit re-poll and `refresh` go through
    // fetchFor, which intentionally keeps the last response visible
    // (anti-flicker); those paths are untouched. Mirrors useUnitPrs.
    setData(null);
    setError(null);
    setLoading(true);

    void fetchFor(unit, myGen);
    const id = window.setInterval(() => {
      void fetchFor(unit, myGen);
    }, POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(id);
    };
  }, [unit, fetchFor]);

  return { data, loading, error, refresh };
}
