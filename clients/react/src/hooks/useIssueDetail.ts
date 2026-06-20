// Issue-detail fetch hook for the R₂ in-tmai issue viewer.
//
// Mirrors `usePrDetail`'s one-shot resource contract (`{ data, loading,
// error }` + a generation guard so a stale in-flight response from a
// previously selected issue never stamps over the current one + a `null`
// arg that parks the hook), but with a single resource: there is ONE
// issue-detail endpoint that returns the FULL issue (body / labels /
// assignees / timestamps / comments), so the viewer needs only this one
// fetch rather than the PR viewer's per-section fan-out.
//
// WHY one-shot, not the 60s poll `useUnitIssues` runs: the viewer only
// mounts after an explicit operator click on an issue row, and an issue's
// body / comments are stable across a single review pass. Re-selecting the
// issue (or switching units, which clears the selection) re-fetches.

import { api, type IssueDetail } from "@/lib/api";
import { usePolledResource } from "./usePolledResource";

export interface UseIssueDetailResult {
  data: IssueDetail | null;
  loading: boolean;
  error: Error | null;
}

export function useIssueDetail(
  repoPath: string | null,
  issueNumber: number | null,
): UseIssueDetailResult {
  // One-shot shared resource (no intervalMs): keyed on (repo, issue). The
  // generation guard drops a stale selection's response AND a response that
  // resolves after unmount. depKey is non-null exactly when both args are.
  // JSON-encode the pair so an arbitrary char in `repoPath` can't collide two
  // distinct (repo, issue) selections onto the same key.
  const depKey =
    repoPath !== null && issueNumber !== null ? JSON.stringify([repoPath, issueNumber]) : null;
  return usePolledResource(depKey, () =>
    api.getIssueDetail(repoPath as string, issueNumber as number),
  );
}
