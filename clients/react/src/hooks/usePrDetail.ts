// PR-detail fetch hooks for the R₂ in-tmai PR viewer (#749).
//
// Thin named wrappers (body / labels / comments / merge-status / diff /
// checks) over the shared one-shot resource (`usePolledResource` with no
// interval), mirroring the `useUnitPrs` contract shape: `{ data, loading,
// error }`, a generation guard so a stale in-flight response from a
// previously selected PR never stamps over the current one (and one that
// resolves after unmount is dropped too), and a `null` dep that parks the
// hook (no fetch).
//
// WHY one-shot, not the 60s poll `useUnitPrs` runs: the viewer only mounts
// after an explicit operator click on a PR row, and a PR's body / diff /
// comments are stable across a single review pass. Re-selecting the PR (or
// switching units, which clears the selection) re-fetches. Keeping it
// poll-free also avoids piling N background intervals (one per detail
// section) onto the existing `useUnitPrs` poll.

import { api, type CiSummary, type PrComment, type PrMergeStatus } from "@/lib/api";
import { type PolledResource, usePolledResource } from "./usePolledResource";

// The one-shot detail hooks expose the read-only triple; `refresh` from the
// shared resource is unused here (a detail pane re-fetches by re-selection).
export type UsePrResourceResult<T> = Pick<PolledResource<T>, "data" | "loading" | "error">;

function prKey(repoPath: string | null, prNumber: number | null): string | null {
  // JSON-encode the pair so an arbitrary char in `repoPath` can't collide two
  // distinct (repo, pr) selections onto the same key.
  return repoPath !== null && prNumber !== null ? JSON.stringify([repoPath, prNumber]) : null;
}

export function usePrBody(
  repoPath: string | null,
  prNumber: number | null,
): UsePrResourceResult<string> {
  return usePolledResource(prKey(repoPath, prNumber), () =>
    // The dep key is non-null exactly when both args are non-null, so the
    // fetcher only ever runs with concrete values.
    api.prBody(repoPath as string, prNumber as number),
  );
}

export function usePrLabels(
  repoPath: string | null,
  prNumber: number | null,
): UsePrResourceResult<string[]> {
  return usePolledResource(prKey(repoPath, prNumber), () =>
    api.prLabels(repoPath as string, prNumber as number),
  );
}

export function usePrComments(
  repoPath: string | null,
  prNumber: number | null,
): UsePrResourceResult<PrComment[]> {
  return usePolledResource(prKey(repoPath, prNumber), () =>
    api.getPrComments(repoPath as string, prNumber as number),
  );
}

export function usePrMergeStatus(
  repoPath: string | null,
  prNumber: number | null,
): UsePrResourceResult<PrMergeStatus> {
  return usePolledResource(prKey(repoPath, prNumber), () =>
    api.getPrMergeStatus(repoPath as string, prNumber as number),
  );
}

export function usePrDiff(
  repoPath: string | null,
  prNumber: number | null,
): UsePrResourceResult<string> {
  return usePolledResource(prKey(repoPath, prNumber), async () => {
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
  // JSON-encode the pair so an `@` in `repoPath`/`branch` can't collide two
  // distinct (repo, branch) selections onto the same key.
  const key = repoPath !== null && branch !== null ? JSON.stringify([repoPath, branch]) : null;
  return usePolledResource(key, () => api.listChecks(repoPath as string, branch as string));
}
