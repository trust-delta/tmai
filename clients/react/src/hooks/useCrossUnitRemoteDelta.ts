// useCrossUnitRemoteDelta — fan the remote-Δ freshness read out across EVERY
// live unit, not only the focused one (aim `cross-unit-remote-delta`). The
// focused-unit instrument (useUnitPrs / useUnitIssues → PrRail Δ accent) only
// ever computed for the ONE focused unit; this lifts the same per-unit PR /
// issue read to a tab-level fan-out so a NON-focused unit's unobserved remote
// artifact can light its tab's cyan freshness dot.
//
// One 60-second poll per unit — the same cadence as the focused-unit hooks;
// cross-repo is already collapsed server-side (`GET /api/units/{unit}/prs|
// issues` return `repos[]`), so this fans out over UNITS only. The unobserved
// VERDICT (cursor comparison) stays with the caller: cursors are client-state
// owned by the UIPrefs context, and the tab-signal seam that consumes this
// already holds them (see `unitHasUnobserved` in remote-delta.ts).
//
// A transient per-unit fetch failure keeps that unit's LAST-known slice (a blip
// must not flicker its freshness dot off); a unit with genuinely zero PRs /
// issues returns an empty `repos[]`, which stays distinct from a failed fetch's
// `null`. Empty `unitNames` parks the hook (no fetch, no interval).

import { useEffect, useState } from "react";
import type { CrossUnitRemoteDelta, UnitRemoteDelta } from "@/components/aim-console/remote-delta";
import { api } from "@/lib/api";

const POLL_INTERVAL_MS = 60_000;

export function useCrossUnitRemoteDelta(unitNames: string[]): CrossUnitRemoteDelta {
  const [data, setData] = useState<CrossUnitRemoteDelta>({});
  // Stable dependency: re-subscribe only when the SET of units changes, not on
  // every 10s slots poll returning a fresh array identity. JSON of the sorted
  // names is separator-safe and lets the effect recover `names` from `key`
  // alone, so `unitNames`'s per-render identity stays out of the deps.
  const key = JSON.stringify([...unitNames].sort());

  useEffect(() => {
    const names = JSON.parse(key) as string[];
    if (names.length === 0) {
      setData({});
      return;
    }
    let cancelled = false;

    const fetchOnce = async () => {
      const entries = await Promise.all(
        names.map(async (name): Promise<[string, UnitRemoteDelta]> => {
          const [prsRes, issuesRes] = await Promise.allSettled([
            api.unitPrs(name),
            api.unitIssues(name),
          ]);
          return [
            name,
            {
              prs: prsRes.status === "fulfilled" ? prsRes.value.repos : null,
              issues: issuesRes.status === "fulfilled" ? issuesRes.value.repos : null,
            },
          ];
        }),
      );
      if (cancelled) return;
      // Keep a unit's prior slice on a transient failure so its dot doesn't
      // flicker; an empty `repos[]` (genuinely none) overwrites, `null` (failed)
      // falls back to the last-known.
      setData((prev) => {
        const next: CrossUnitRemoteDelta = {};
        for (const [name, delta] of entries) {
          const prior = prev[name];
          next[name] = {
            prs: delta.prs ?? prior?.prs ?? null,
            issues: delta.issues ?? prior?.issues ?? null,
          };
        }
        return next;
      });
    };

    void fetchOnce();
    const id = window.setInterval(() => {
      void fetchOnce();
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [key]);

  return data;
}
