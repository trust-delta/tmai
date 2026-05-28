// Polling hook for a repo's GitHub issues — the data behind the R
// panel's 📋 Issues section (approach
// `doc/approaches/2026-05-29-r-panel-as-project-artifact-inventory.md`).
//
// No unit-scoped issues wire exists yet (PR `unitPrs` has one — issues
// don't), so this hook fans out per repo path. R's IssuesSection feeds
// it the currently-focused project path; the R panel deliberately
// stays one-repo-at-a-time for issues (multi-repo aggregation would
// belong on the tmai-core side, and is deferred along with L's
// cross-project work — see the approach's defer list).
//
// 60-second poll matches the sibling unit-scoped hooks
// (`useDecisions` / `useApproaches`). Anti-flicker pattern same as
// the rest: keep last response visible while re-fetching; `loading`
// reflects only the initial fetch.

import { useEffect, useRef, useState } from "react";
import { api, type IssueInfo } from "@/lib/api";

const POLL_INTERVAL_MS = 60_000;

export interface UseIssuesResult {
  data: IssueInfo[] | null;
  loading: boolean;
  error: Error | null;
}

export function useIssues(repoPath: string | null): UseIssuesResult {
  const [data, setData] = useState<IssueInfo[] | null>(null);
  const [loading, setLoading] = useState(repoPath !== null);
  const [error, setError] = useState<Error | null>(null);
  // `generationRef` gates against stale responses across repoPath
  // *changes* (the effect re-trigger). `requestSeqRef` gates within
  // the SAME repoPath against overlapping polls: a slow first fetch
  // returning after a faster second one would otherwise overwrite
  // the newer data. Both guards compose — either a unit change OR a
  // newer same-unit request causes earlier responses to be dropped.
  const generationRef = useRef(0);
  const requestSeqRef = useRef(0);

  useEffect(() => {
    if (!repoPath) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
    const myGen = ++generationRef.current;
    setData(null);
    setError(null);
    setLoading(true);

    const fetchOnce = async () => {
      const myReq = ++requestSeqRef.current;
      try {
        const res = await api.listIssues(repoPath);
        if (myGen !== generationRef.current || myReq !== requestSeqRef.current) return;
        setData(res);
        setError(null);
      } catch (e) {
        if (myGen !== generationRef.current || myReq !== requestSeqRef.current) return;
        setError(e instanceof Error ? e : new Error(String(e)));
      } finally {
        if (myGen === generationRef.current && myReq === requestSeqRef.current) {
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
  }, [repoPath]);

  return { data, loading, error };
}
