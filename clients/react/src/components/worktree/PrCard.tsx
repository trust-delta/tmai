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
      return "text-success";
    case "FAILURE":
      return "text-destructive";
    case "PENDING":
      return "text-warning";
    default:
      return "text-subtle-foreground";
  }
}

// Returns bg color class for CI dot
function ciDotBg(status: PrInfo["check_status"]): string {
  switch (status) {
    case "SUCCESS":
      return "bg-success";
    case "FAILURE":
      return "bg-destructive";
    case "PENDING":
      return "bg-warning";
    default:
      return "bg-muted-foreground";
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
    <div className="rounded-lg border border-hairline bg-surface p-2">
      {/* Header: PR number + draft badge + review decision */}
      <div className="flex items-center gap-1.5 text-[11px]">
        <a
          href={pr.url}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-success hover:underline"
        >
          PR #{pr.number}
        </a>
        {pr.is_draft && (
          <span className="rounded bg-muted-foreground/15 px-1 py-0.5 text-[10px] text-muted-foreground">
            draft
          </span>
        )}
        {pr.review_decision && (
          <span
            className={`text-[10px] ${
              pr.review_decision === "APPROVED"
                ? "text-success"
                : pr.review_decision === "CHANGES_REQUESTED"
                  ? "text-warning"
                  : "text-muted-foreground"
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
      <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{pr.title}</div>

      {/* Branch flow (incoming PRs) */}
      {showBranchFlow && targetBranch && (
        <div className="mt-0.5 text-[10px] text-subtle-foreground">
          {pr.head_branch} → {targetBranch}
        </div>
      )}

      {/* Stats: additions/deletions + reviews/comments */}
      <div className="mt-0.5 flex items-center gap-2 text-[10px] text-subtle-foreground">
        {(pr.additions > 0 || pr.deletions > 0) && (
          <span>
            <span className="text-success">+{pr.additions}</span>{" "}
            <span className="text-destructive">-{pr.deletions}</span>
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
          className="rounded bg-surface px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-surface-strong hover:text-foreground"
        >
          Comments
        </button>
        <button
          type="button"
          onClick={() => onOpenDetail({ kind: "pr-files", prNumber: pr.number })}
          className="rounded bg-surface px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-surface-strong hover:text-foreground"
        >
          Files
        </button>
        <button
          type="button"
          onClick={() => onOpenDetail({ kind: "merge-status", prNumber: pr.number })}
          className="rounded bg-surface px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-surface-strong hover:text-foreground"
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
              className="inline-flex items-center gap-0.5 rounded bg-success/10 px-1.5 py-0.5 text-[10px] text-success transition-colors hover:bg-success/20 hover:text-success"
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
            className="inline-flex items-center gap-0.5 rounded bg-success/10 px-1.5 py-0.5 text-[10px] text-success transition-colors hover:bg-success/20 hover:text-success"
            title={`Go to branch: ${pr.head_branch}`}
          >
            <svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M11.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm-2.25.75a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.492 2.492 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM3.5 3.25a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0Z" />
            </svg>
            Branch
          </button>
        )}
      </div>
    </div>
  );
}
