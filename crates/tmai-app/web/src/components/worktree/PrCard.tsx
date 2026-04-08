import type { IssueInfo, PrInfo } from "@/lib/api";
import { extractIssueNumbers, extractIssueRefs } from "@/lib/issue-utils";
import type { DetailView } from "./DetailPanel";

interface PrCardProps {
  pr: PrInfo;
  onOpenDetail: (view: DetailView | null) => void;
  /** Branch flow display: shows "head → base" for incoming PRs */
  showBranchFlow?: boolean;
  /** Target branch name (used for branch flow display) */
  targetBranch?: string;
  /** AI Merge handler — shown when provided */
  onAiMerge?: () => void;
  /** Disables AI Merge button */
  actionBusy?: boolean;
  /** Navigate to a linked issue in Issues tab */
  onNavigateToIssue?: (issue: IssueInfo) => void;
  /** Navigate to branch in Branches tab */
  onNavigateToBranch?: (branch: string) => void;
  /** Available issues for cross-referencing */
  issues?: IssueInfo[];
}

// Returns color class for CI status
function ciColor(status: PrInfo["check_status"]): string {
  switch (status) {
    case "SUCCESS":
      return "text-green-400";
    case "FAILURE":
      return "text-red-400";
    case "PENDING":
      return "text-yellow-400";
    default:
      return "text-zinc-600";
  }
}

// Returns bg color class for CI dot
function ciDotBg(status: PrInfo["check_status"]): string {
  switch (status) {
    case "SUCCESS":
      return "bg-green-400";
    case "FAILURE":
      return "bg-red-400";
    case "PENDING":
      return "bg-yellow-400";
    default:
      return "bg-zinc-600";
  }
}

// Returns human-readable CI label
function ciLabel(status: PrInfo["check_status"]): string {
  switch (status) {
    case "SUCCESS":
      return "CI passed";
    case "FAILURE":
      return "CI failed";
    case "PENDING":
      return "CI running";
    default:
      return "CI unknown";
  }
}

// Unified PR card component used for both source and incoming PRs
export function PrCard({
  pr,
  onOpenDetail,
  showBranchFlow,
  targetBranch,
  onAiMerge,
  actionBusy,
  onNavigateToIssue,
  onNavigateToBranch,
  issues,
}: PrCardProps) {
  // Extract linked issue numbers from branch name and PR title
  const linkedIssues = (() => {
    if (!issues || issues.length === 0) return [];
    const nums = extractIssueNumbers(pr.head_branch);
    for (const n of extractIssueRefs(pr.title)) {
      if (!nums.includes(n)) nums.push(n);
    }
    return issues.filter((i) => nums.includes(i.number));
  })();
  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.03] p-2">
      {/* Header: PR number + draft badge + review decision */}
      <div className="flex items-center gap-1.5 text-[11px]">
        <a
          href={pr.url}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-green-400 hover:underline"
        >
          PR #{pr.number}
        </a>
        {pr.is_draft && (
          <span className="rounded bg-zinc-500/15 px-1 py-0.5 text-[10px] text-zinc-500">
            draft
          </span>
        )}
        {pr.review_decision && (
          <span
            className={`text-[10px] ${
              pr.review_decision === "APPROVED"
                ? "text-green-400"
                : pr.review_decision === "CHANGES_REQUESTED"
                  ? "text-orange-400"
                  : "text-zinc-500"
            }`}
          >
            {pr.review_decision === "APPROVED"
              ? "Approved"
              : pr.review_decision === "CHANGES_REQUESTED"
                ? "Changes requested"
                : "Review required"}
          </span>
        )}
      </div>

      {/* Title */}
      <div className="mt-0.5 truncate text-[11px] text-zinc-400">{pr.title}</div>

      {/* Branch flow (incoming PRs) */}
      {showBranchFlow && targetBranch && (
        <div className="mt-0.5 text-[10px] text-zinc-600">
          {pr.head_branch} → {targetBranch}
        </div>
      )}

      {/* Stats: additions/deletions + reviews/comments */}
      <div className="mt-0.5 flex items-center gap-2 text-[10px] text-zinc-600">
        {(pr.additions > 0 || pr.deletions > 0) && (
          <span>
            <span className="text-emerald-400">+{pr.additions}</span>{" "}
            <span className="text-red-400">-{pr.deletions}</span>
          </span>
        )}
        {pr.reviews > 0 && (
          <span>
            {pr.reviews} review{pr.reviews !== 1 ? "s" : ""}
          </span>
        )}
        {pr.comments > 0 && (
          <span>
            {pr.comments} comment{pr.comments !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* CI status label */}
      {pr.check_status && (
        <div className="mt-1 flex items-center gap-1.5 text-[10px]">
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${ciDotBg(pr.check_status)}`} />
          <span className={ciColor(pr.check_status)}>{ciLabel(pr.check_status)}</span>
        </div>
      )}

      {/* Detail buttons */}
      <div className="mt-1.5 flex gap-1">
        <button
          type="button"
          onClick={() => onOpenDetail({ kind: "pr-comments", prNumber: pr.number })}
          className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-200"
        >
          Comments
        </button>
        <button
          type="button"
          onClick={() => onOpenDetail({ kind: "pr-files", prNumber: pr.number })}
          className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-200"
        >
          Files
        </button>
        <button
          type="button"
          onClick={() => onOpenDetail({ kind: "merge-status", prNumber: pr.number })}
          className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-200"
        >
          Merge
        </button>
        {/* Cross-navigation buttons */}
        {onNavigateToIssue &&
          linkedIssues.length > 0 &&
          linkedIssues.map((issue) => (
            <button
              key={issue.number}
              type="button"
              onClick={() => onNavigateToIssue(issue)}
              className="inline-flex items-center gap-0.5 rounded bg-green-500/10 px-1.5 py-0.5 text-[10px] text-green-400 transition-colors hover:bg-green-500/20 hover:text-green-300"
              title={`Go to issue #${issue.number}: ${issue.title}`}
            >
              <svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" />
                <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z" />
              </svg>
              #{issue.number}
            </button>
          ))}
        {onNavigateToBranch && (
          <button
            type="button"
            onClick={() => onNavigateToBranch(pr.head_branch)}
            className="inline-flex items-center gap-0.5 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-400 transition-colors hover:bg-emerald-500/20 hover:text-emerald-300"
            title={`Go to branch: ${pr.head_branch}`}
          >
            <svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M11.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm-2.25.75a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.492 2.492 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM3.5 3.25a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0Z" />
            </svg>
            Branch
          </button>
        )}
      </div>

      {/* AI Merge button (incoming PRs) */}
      {onAiMerge && (
        <button
          type="button"
          onClick={onAiMerge}
          disabled={actionBusy}
          className="mt-1.5 w-full rounded bg-purple-500/15 px-2 py-1 text-[11px] font-medium text-purple-400 transition-colors hover:bg-purple-500/25 disabled:opacity-50"
        >
          AI Merge PR #{pr.number}
        </button>
      )}
    </div>
  );
}
