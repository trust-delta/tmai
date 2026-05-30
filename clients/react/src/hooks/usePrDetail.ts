// PR-detail fetch hooks for the R₂ in-tmai PR viewer (#749).
//
// One generic one-shot resource hook (`usePrResource`) plus thin named
// wrappers (body / labels / comments / merge-status / diff / checks),
// mirroring the `useUnitPrs` contract shape: `{ data, loading, error }`,
// a generation guard so a stale in-flight response from a previously
// selected PR never stamps over the current one, and a `null` dep that
// parks the hook (no fetch).
//
// WHY one-shot, not the 60s poll `useUnitPrs` runs: the viewer only
// mounts after an explicit operator click on a PR row (no auto-open on
// focus — viewer approach negative space), and a PR's body / diff /
// comments are stable across a single review pass. Re-selecting the PR
// (or switching units, which clears the selection) re-fetches. Keeping
// it poll-free also avoids piling N background intervals (one per
// detail section) onto the existing `useUnitPrs` poll.

import { useEffect, useRef, useState } from "react";
import { api, type CiSummary, type PrComment, type PrMergeStatus } from "@/lib/api";

export interface UsePrResourceResult<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

// `depKey` is the stable identity of the request (e.g. `${repo}#${n}`);
// the effect re-runs only when it changes. `fetcher` is read through a
// ref so a fresh closure each render does not retrigger the effect — the
// same anti-churn discipline as `useUnitPrs`, expressed for a one-shot.
function usePrResource<T>(
  depKey: string | null,
  fetcher: () => Promise<T>,
): UsePrResourceResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(depKey !== null);
  const [error, setError] = useState<Error | null>(null);
  const generationRef = useRef(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    if (depKey === null) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
    const myGen = ++generationRef.current;
    setData(null);
    setError(null);
    setLoading(true);
    void (async () => {
      try {
        const res = await fetcherRef.current();
        if (myGen !== generationRef.current) return;
        setData(res);
        setError(null);
      } catch (e) {
        if (myGen !== generationRef.current) return;
        setError(e instanceof Error ? e : new Error(String(e)));
      } finally {
        if (myGen === generationRef.current) setLoading(false);
      }
    })();
  }, [depKey]);

  return { data, loading, error };
}

function prKey(repoPath: string | null, prNumber: number | null): string | null {
  return repoPath !== null && prNumber !== null ? `${repoPath}#${prNumber}` : null;
}

export function usePrBody(
  repoPath: string | null,
  prNumber: number | null,
): UsePrResourceResult<string> {
  return usePrResource(prKey(repoPath, prNumber), () =>
    // The dep key is non-null exactly when both args are non-null, so the
    // fetcher only ever runs with concrete values.
    api.prBody(repoPath as string, prNumber as number),
  );
}

export function usePrLabels(
  repoPath: string | null,
  prNumber: number | null,
): UsePrResourceResult<string[]> {
  return usePrResource(prKey(repoPath, prNumber), () =>
    api.prLabels(repoPath as string, prNumber as number),
  );
}

export function usePrComments(
  repoPath: string | null,
  prNumber: number | null,
): UsePrResourceResult<PrComment[]> {
  return usePrResource(prKey(repoPath, prNumber), () =>
    api.getPrComments(repoPath as string, prNumber as number),
  );
}

export function usePrMergeStatus(
  repoPath: string | null,
  prNumber: number | null,
): UsePrResourceResult<PrMergeStatus> {
  return usePrResource(prKey(repoPath, prNumber), () =>
    api.getPrMergeStatus(repoPath as string, prNumber as number),
  );
}

export function usePrDiff(
  repoPath: string | null,
  prNumber: number | null,
): UsePrResourceResult<string> {
  return usePrResource(prKey(repoPath, prNumber), async () => {
    const res = await api.prDiff(repoPath as string, prNumber as number);
    return res.patch;
  });
}

// CI checks key on (repo, branch) — a PR's head branch is the natural
// identity for `gh`'s check rollup; `getCiFailureLog` drill-down is
// operator-initiated inside the section, so it is not a hook.
export function usePrChecks(
  repoPath: string | null,
  branch: string | null,
): UsePrResourceResult<CiSummary> {
  const key = repoPath !== null && branch !== null ? `${repoPath}@${branch}` : null;
  return usePrResource(key, () => api.listChecks(repoPath as string, branch as string));
}
