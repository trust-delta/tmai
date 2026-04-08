import { useMemo, useState } from "react";
import type { IssueInfo, PrInfo, WorktreeSnapshot } from "@/lib/api";
import { extractIssueNumbers, extractIssueRefs } from "@/lib/issue-utils";

// Worktree status matched to an issue
interface IssueWorktreeStatus {
  worktree: WorktreeSnapshot;
  isAgentActive: boolean;
}

// PR linked to an issue (via branch name or PR title/body refs)
export interface IssuePrLink {
  pr: PrInfo;
  branch: string;
}

interface IssuesPanelProps {
  issues: IssueInfo[];
  worktrees: WorktreeSnapshot[];
  prMap: Record<string, PrInfo>;
  branches: string[];
  selectedIssue: IssueInfo | null;
  onSelectIssue: (issue: IssueInfo | null) => void;
  /** Navigate to branch/worktree in Branches tab */
  onNavigateToBranch?: (branch: string) => void;
  /** Navigate to PR's branch in Branches tab */
  onNavigateToPr?: (branch: string) => void;
}

// Build a map of issue number → linked PRs by cross-referencing branches and PR metadata
export function buildIssuePrMap(
  prMap: Record<string, PrInfo>,
  _branches: string[],
): Map<number, IssuePrLink> {
  const map = new Map<number, IssuePrLink>();

  // 1. For each PR, extract issue numbers from the head branch name
  for (const [branch, pr] of Object.entries(prMap)) {
    const nums = extractIssueNumbers(branch);
    for (const num of nums) {
      if (!map.has(num)) {
        map.set(num, { pr, branch });
      }
    }
    // 2. Also extract issue refs from PR title (e.g. "Fixes #42")
    const titleRefs = extractIssueRefs(pr.title);
    for (const num of titleRefs) {
      if (!map.has(num)) {
        map.set(num, { pr, branch });
      }
    }
  }

  // 3. For branches without a PR, still record the branch link
  //    (handled by issueWorktreeMap + issueBranchMap in the component)

  return map;
}

// Issues list panel — replaces the graph area when Issues tab is active
export function IssuesPanel({
  issues,
  worktrees,
  prMap,
  branches,
  selectedIssue,
  onSelectIssue,
  onNavigateToBranch,
  onNavigateToPr,
}: IssuesPanelProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLabels, setSelectedLabels] = useState<Set<string>>(new Set());

  // Build issue-number → worktree status map
  const issueWorktreeMap = useMemo(() => {
    const map = new Map<number, IssueWorktreeStatus>();
    for (const wt of worktrees) {
      if (wt.is_main) continue;
      const branch = wt.branch ?? wt.name;
      const nums = extractIssueNumbers(branch);
      for (const num of nums) {
        if (!map.has(num)) {
          const isAgentActive = wt.agent_status === "in-progress" || wt.agent_status === "waiting";
          map.set(num, { worktree: wt, isAgentActive });
        }
      }
    }
    return map;
  }, [worktrees]);

  // Build issue-number → linked PR map
  const issuePrMap = useMemo(() => buildIssuePrMap(prMap, branches), [prMap, branches]);

  // Build issue-number → branch name map (branches not yet linked via worktree or PR)
  const issueBranchMap = useMemo(() => {
    const map = new Map<number, string>();
    for (const branch of branches) {
      const nums = extractIssueNumbers(branch);
      for (const num of nums) {
        if (!map.has(num)) {
          map.set(num, branch);
        }
      }
    }
    return map;
  }, [branches]);

  // Collect all unique labels for filter chips
  const allLabels = useMemo(() => {
    const labelMap = new Map<string, { name: string; color: string }>();
    for (const issue of issues) {
      for (const label of issue.labels) {
        if (!labelMap.has(label.name)) {
          labelMap.set(label.name, label);
        }
      }
    }
    return Array.from(labelMap.values());
  }, [issues]);

  // Filter issues by search query and selected labels
  const filteredIssues = useMemo(() => {
    return issues.filter((issue) => {
      // Text filter
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchesText =
          issue.title.toLowerCase().includes(q) || issue.number.toString().includes(q);
        if (!matchesText) return false;
      }
      // Label filter
      if (selectedLabels.size > 0) {
        const hasLabel = issue.labels.some((l) => selectedLabels.has(l.name));
        if (!hasLabel) return false;
      }
      return true;
    });
  }, [issues, searchQuery, selectedLabels]);

  // Toggle a label filter
  const toggleLabel = (name: string) => {
    setSelectedLabels((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  return (
    <div className="flex-1 overflow-auto p-6">
      {/* Search and filters */}
      <div className="mb-4">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search issues..."
          className="w-full rounded-lg bg-white/5 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 outline-none ring-1 ring-white/10 transition-colors focus:ring-white/20"
        />
        {allLabels.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {allLabels.map((label) => (
              <button
                key={label.name}
                type="button"
                onClick={() => toggleLabel(label.name)}
                className="rounded-full px-2 py-0.5 text-[11px] transition-opacity"
                style={{
                  backgroundColor: selectedLabels.has(label.name)
                    ? `#${label.color}33`
                    : `#${label.color}15`,
                  color: `#${label.color}`,
                  opacity: selectedLabels.size > 0 && !selectedLabels.has(label.name) ? 0.5 : 1,
                }}
              >
                {label.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Issue count */}
      <div className="mb-3 text-[11px] text-zinc-500">
        {filteredIssues.length} issue{filteredIssues.length !== 1 ? "s" : ""}
        {filteredIssues.length !== issues.length ? ` (${issues.length} total)` : ""}
      </div>

      {/* Issue list */}
      {filteredIssues.length === 0 ? (
        <div className="flex items-center justify-center py-20 text-sm text-zinc-500">
          {issues.length === 0 ? "No open issues" : "No issues match filters"}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filteredIssues.map((issue) => {
            const isSelected = selectedIssue?.number === issue.number;
            const wtStatus = issueWorktreeMap.get(issue.number);
            const prLink = issuePrMap.get(issue.number);
            const linkedBranch = issueBranchMap.get(issue.number);
            return (
              <button
                type="button"
                key={issue.number}
                onClick={() => onSelectIssue(isSelected ? null : issue)}
                className={`rounded-lg border p-3 text-left transition-colors ${
                  isSelected
                    ? "border-cyan-500/30 bg-cyan-500/[0.06]"
                    : "border-white/5 bg-white/[0.02] hover:bg-white/[0.05]"
                }`}
              >
                <div className="flex items-start gap-2">
                  <span className="shrink-0 text-sm font-medium text-green-400">
                    #{issue.number}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-zinc-200">{issue.title}</span>
                      {/* Cross-navigation badges: clickable to jump to branch/PR */}
                      {wtStatus && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            const branch = wtStatus.worktree.branch ?? wtStatus.worktree.name;
                            onNavigateToBranch?.(branch);
                          }}
                          className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                            wtStatus.isAgentActive
                              ? "bg-cyan-500/15 text-cyan-400 hover:bg-cyan-500/25"
                              : "bg-amber-500/15 text-amber-400 hover:bg-amber-500/25"
                          }`}
                          title={`Go to branch: ${wtStatus.worktree.branch ?? wtStatus.worktree.name}`}
                        >
                          <svg
                            width="10"
                            height="10"
                            viewBox="0 0 16 16"
                            fill="currentColor"
                            aria-hidden="true"
                          >
                            <path d="M11.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm-2.25.75a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.492 2.492 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM3.5 3.25a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0Z" />
                          </svg>
                          {wtStatus.isAgentActive ? "In Progress" : "Worktree"}
                        </button>
                      )}
                      {prLink ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onNavigateToPr?.(prLink.branch);
                          }}
                          className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                            prLink.pr.state === "MERGED"
                              ? "bg-purple-500/15 text-purple-400 hover:bg-purple-500/25"
                              : prLink.pr.is_draft
                                ? "bg-zinc-500/15 text-zinc-400 hover:bg-zinc-500/25"
                                : "bg-green-500/15 text-green-400 hover:bg-green-500/25"
                          }`}
                          title={`Go to PR #${prLink.pr.number}: ${prLink.pr.title}`}
                        >
                          <svg
                            width="10"
                            height="10"
                            viewBox="0 0 16 16"
                            fill="currentColor"
                            aria-hidden="true"
                          >
                            <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" />
                          </svg>
                          {prLink.pr.state === "MERGED"
                            ? `PR #${prLink.pr.number} Merged`
                            : prLink.pr.is_draft
                              ? `PR #${prLink.pr.number} Draft`
                              : `PR #${prLink.pr.number} Open`}
                        </button>
                      ) : linkedBranch && !wtStatus ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onNavigateToBranch?.(linkedBranch);
                          }}
                          className="inline-flex shrink-0 items-center gap-1 rounded-full bg-zinc-500/15 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400 transition-colors hover:bg-zinc-500/25"
                          title={`Go to branch: ${linkedBranch}`}
                        >
                          <svg
                            width="10"
                            height="10"
                            viewBox="0 0 16 16"
                            fill="currentColor"
                            aria-hidden="true"
                          >
                            <path d="M11.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm-2.25.75a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.492 2.492 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM3.5 3.25a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0Z" />
                          </svg>
                          Branch
                        </button>
                      ) : null}
                    </div>
                    {/* Labels */}
                    {issue.labels.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {issue.labels.map((label) => (
                          <span
                            key={label.name}
                            className="rounded-full px-1.5 py-0.5 text-[10px]"
                            style={{
                              backgroundColor: `#${label.color}22`,
                              color: `#${label.color}`,
                            }}
                          >
                            {label.name}
                          </span>
                        ))}
                      </div>
                    )}
                    {/* Assignees */}
                    {issue.assignees.length > 0 && (
                      <div className="mt-1 text-[10px] text-zinc-500">
                        {issue.assignees.join(", ")}
                      </div>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
