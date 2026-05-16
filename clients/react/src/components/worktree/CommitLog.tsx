import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { CopyableSha } from "./CopyableSha";

interface CommitData {
  sha: string;
  subject: string;
  body: string;
}

interface CommitLogProps {
  repoPath: string;
  base: string;
  branch: string;
  count: number;
}

// Lazy-loaded commit log for a branch
export function CommitLog({ repoPath, base, branch, count }: CommitLogProps) {
  const [commits, setCommits] = useState<CommitData[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [expandedSha, setExpandedSha] = useState<string | null>(null);

  useEffect(() => {
    setCommits(null);
    setExpandedSha(null);
    setLoading(true);
    api
      .gitLog(repoPath, base, branch)
      .then(setCommits)
      .catch(() => setCommits([]))
      .finally(() => setLoading(false));
  }, [repoPath, base, branch]);

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <span className="text-[10px]">{expanded ? "\u25BE" : "\u25B8"}</span>
        <span>Commits ({count})</span>
      </button>
      {expanded && (
        <div className="mt-1.5">
          {loading && <div className="text-[11px] text-subtle-foreground py-1">Loading...</div>}
          {commits && commits.length === 0 && !loading && (
            <div className="text-[11px] text-subtle-foreground py-1">No commits</div>
          )}
          {commits?.map((c) => (
            <div key={c.sha} className="border-b border-hairline last:border-0">
              <button
                type="button"
                onClick={() => setExpandedSha((prev) => (prev === c.sha ? null : c.sha))}
                className="flex w-full items-baseline gap-2 py-1 text-left hover:bg-surface rounded px-1 -mx-1 transition-colors"
              >
                <CopyableSha sha={c.sha} className="text-[10px] text-primary" />
                <span className="text-[11px] text-muted-foreground truncate">{c.subject}</span>
              </button>
              {expandedSha === c.sha && (
                <div className="px-1 pb-2 select-text">
                  <div className="rounded bg-surface px-2 py-1.5 text-[11px] text-foreground font-mono whitespace-pre-wrap break-words">
                    {c.subject}
                    {c.body && (
                      <>
                        {"\n\n"}
                        <span className="text-muted-foreground">{c.body}</span>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
