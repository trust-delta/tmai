import { useMemo, useState } from "react";
import type { IssueInfo, WorktreeSnapshot } from "@/lib/api";
import { extractIssueNumbers } from "@/lib/issue-utils";

// Worktree status matched to an issue
interface IssueWorktreeStatus {
  worktree: WorktreeSnapshot;
  isAgentActive: boolean;
}

interface IssuesPanelProps {
  issues: IssueInfo[];
  worktrees: WorktreeSnapshot[];
  selectedIssue: IssueInfo | null;
  onSelectIssue: (issue: IssueInfo | null) => void;
}

// Issues list panel — replaces the graph area when Issues tab is active
export function IssuesPanel({ issues, worktrees, selectedIssue, onSelectIssue }: IssuesPanelProps) {
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
                      {wtStatus && (
                        <span
                          className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                            wtStatus.isAgentActive
                              ? "bg-cyan-500/15 text-cyan-400"
                              : "bg-amber-500/15 text-amber-400"
                          }`}
                        >
                          {wtStatus.isAgentActive ? "In Progress" : "Worktree"}
                        </span>
                      )}
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
