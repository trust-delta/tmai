import type { PrInfo } from "@/lib/api";
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
}: PrCardProps) {
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
