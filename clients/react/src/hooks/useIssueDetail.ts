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
// WHY one-shot, not the 60s poll `useIssues` runs: the viewer only mounts
// after an explicit operator click on an issue row (no auto-open on focus
// — viewer-approach negative space), and an issue's body / comments are
// stable across a single review pass. Re-selecting the issue (or
// switching units, which clears the selection) re-fetches.

import { useEffect, useRef, useState } from "react";
import { api, type IssueDetail } from "@/lib/api";

export interface UseIssueDetailResult {
  data: IssueDetail | null;
  loading: boolean;
  error: Error | null;
}

export function useIssueDetail(
  repoPath: string | null,
  issueNumber: number | null,
): UseIssueDetailResult {
  const [data, setData] = useState<IssueDetail | null>(null);
  const [loading, setLoading] = useState(repoPath !== null && issueNumber !== null);
  const [error, setError] = useState<Error | null>(null);
  // Gates against stale responses across (repo, issue) changes — a slow
  // fetch from a previously selected issue returning after a newer
  // selection must not stamp over the current data.
  const generationRef = useRef(0);

  useEffect(() => {
    if (repoPath === null || issueNumber === null) {
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
        const res = await api.getIssueDetail(repoPath, issueNumber);
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
  }, [repoPath, issueNumber]);

  return { data, loading, error };
}
