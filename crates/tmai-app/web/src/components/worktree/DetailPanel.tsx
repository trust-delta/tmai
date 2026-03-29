import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  type BranchListResponse,
  type CiFailureLog,
  type PrChangedFile,
  type PrComment,
  type PrMergeStatus,
  type WorktreeDiffResponse,
} from "@/lib/api";
import { DiffViewer } from "./DiffViewer";
import type { BranchNode } from "./graph/types";

// Discriminated union for what the detail panel is showing
export type DetailView =
  | { kind: "diff" }
  | { kind: "pr-comments"; prNumber: number }
  | { kind: "pr-files"; prNumber: number }
  | { kind: "merge-status"; prNumber: number }
  | { kind: "ci-log"; runId: number; checkName: string };

interface DetailPanelProps {
  view: DetailView;
  projectPath: string;
  activeNode: BranchNode;
  branches: BranchListResponse | null;
  onClose: () => void;
}

// Strip ANSI escape sequences from text
function stripAnsi(text: string): string {
  return text.replace(
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI escape codes requires matching control characters
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
    "",
  );
}

// Format ISO timestamp as relative time string
function formatRelative(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// Header title derived from the current view
function viewTitle(view: DetailView): string {
  switch (view.kind) {
    case "diff":
      return "Diff";
    case "pr-comments":
      return `PR #${view.prNumber} Comments`;
    case "pr-files":
      return `PR #${view.prNumber} Files`;
    case "merge-status":
      return `PR #${view.prNumber} Merge Status`;
    case "ci-log":
      return `CI Log: ${view.checkName}`;
  }
}

// Sub-view: diff display
function DiffView({
  projectPath,
  activeNode,
  branches,
}: {
  projectPath: string;
  activeNode: BranchNode;
  branches: BranchListResponse | null;
}) {
  const [diffData, setDiffData] = useState<WorktreeDiffResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDiff = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let data: WorktreeDiffResponse;
      if (activeNode.worktree) {
        data = await api.getWorktreeDiff(activeNode.worktree.path);
      } else {
        const base = activeNode.parent ?? branches?.default_branch ?? "main";
        data = await api.gitBranchDiff(projectPath, activeNode.name, base);
      }
      setDiffData(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load diff");
    } finally {
      setLoading(false);
    }
  }, [
    activeNode.worktree,
    activeNode.parent,
    activeNode.name,
    branches?.default_branch,
    projectPath,
  ]);

  useEffect(() => {
    fetchDiff();
  }, [fetchDiff]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(fetchDiff, 30_000);
    return () => clearInterval(interval);
  }, [fetchDiff]);

  if (loading) return <div className="text-sm text-zinc-500">Loading diff...</div>;
  if (error) return <div className="text-sm text-red-400">{error}</div>;
  if (!diffData?.diff) return <div className="text-sm text-zinc-500">No changes</div>;
  return <DiffViewer diff={diffData.diff} />;
}

// Sub-view: PR comments timeline
function PrCommentsView({ projectPath, prNumber }: { projectPath: string; prNumber: number }) {
  const [comments, setComments] = useState<PrComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchComments = useCallback(async () => {
    try {
      const data = await api.getPrComments(projectPath, prNumber);
      setComments(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load comments");
    } finally {
      setLoading(false);
    }
  }, [projectPath, prNumber]);

  useEffect(() => {
    setLoading(true);
    fetchComments();
  }, [fetchComments]);

  useEffect(() => {
    const interval = setInterval(fetchComments, 30_000);
    return () => clearInterval(interval);
  }, [fetchComments]);

  if (loading) return <div className="text-sm text-zinc-500">Loading comments...</div>;
  if (error) return <div className="text-sm text-red-400">{error}</div>;
  if (comments.length === 0) return <div className="text-sm text-zinc-500">No comments</div>;

  return (
    <div className="flex flex-col gap-4">
      {comments.map((comment) => (
        <div key={comment.url} className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-semibold text-zinc-200">{comment.author}</span>
            <span className="text-zinc-600">{formatRelative(comment.created_at)}</span>
            {comment.comment_type !== "comment" && (
              <span className="rounded bg-blue-500/15 px-1 py-0.5 text-[10px] text-blue-400">
                {comment.comment_type}
              </span>
            )}
          </div>
          {/* Review comment: show file path and diff hunk context */}
          {comment.path && (
            <div className="mt-2 rounded bg-zinc-800/50 px-2 py-1.5">
              <div className="text-[11px] font-mono text-zinc-400">{comment.path}</div>
              {comment.diff_hunk && (
                <pre className="mt-1 text-[10px] leading-relaxed text-zinc-600 overflow-x-auto">
                  {comment.diff_hunk}
                </pre>
              )}
            </div>
          )}
          <div className="mt-2 whitespace-pre-wrap break-words text-sm text-zinc-300">
            {comment.body}
          </div>
        </div>
      ))}
    </div>
  );
}

// Sub-view: PR changed files list
function PrFilesView({ projectPath, prNumber }: { projectPath: string; prNumber: number }) {
  const [files, setFiles] = useState<PrChangedFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchFiles = useCallback(async () => {
    try {
      const data = await api.getPrFiles(projectPath, prNumber);
      setFiles(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load files");
    } finally {
      setLoading(false);
    }
  }, [projectPath, prNumber]);

  useEffect(() => {
    setLoading(true);
    fetchFiles();
  }, [fetchFiles]);

  useEffect(() => {
    const interval = setInterval(fetchFiles, 30_000);
    return () => clearInterval(interval);
  }, [fetchFiles]);

  if (loading) return <div className="text-sm text-zinc-500">Loading files...</div>;
  if (error) return <div className="text-sm text-red-400">{error}</div>;
  if (files.length === 0) return <div className="text-sm text-zinc-500">No changed files</div>;

  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  const totalAdd = sorted.reduce((sum, f) => sum + f.additions, 0);
  const totalDel = sorted.reduce((sum, f) => sum + f.deletions, 0);

  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs text-zinc-400">
        {sorted.length} file{sorted.length !== 1 ? "s" : ""} changed:{" "}
        <span className="text-emerald-400">+{totalAdd}</span>{" "}
        <span className="text-red-400">-{totalDel}</span>
      </div>
      <div className="flex flex-col gap-1">
        {sorted.map((file) => (
          <div
            key={file.path}
            className="flex items-center gap-2 rounded bg-white/[0.03] px-3 py-1.5 text-xs"
          >
            <span className="flex-1 break-all font-mono text-zinc-300">{file.path}</span>
            <span className="shrink-0 text-emerald-400">+{file.additions}</span>
            <span className="shrink-0 text-red-400">-{file.deletions}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Sub-view: PR merge status checklist
function MergeStatusView({ projectPath, prNumber }: { projectPath: string; prNumber: number }) {
  const [status, setStatus] = useState<PrMergeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const data = await api.getPrMergeStatus(projectPath, prNumber);
      setStatus(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load merge status");
    } finally {
      setLoading(false);
    }
  }, [projectPath, prNumber]);

  useEffect(() => {
    setLoading(true);
    fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    const interval = setInterval(fetchStatus, 30_000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  if (loading) return <div className="text-sm text-zinc-500">Loading merge status...</div>;
  if (error) return <div className="text-sm text-red-400">{error}</div>;
  if (!status) return <div className="text-sm text-zinc-500">No data</div>;

  // Determine icon and color for each check item
  const mergeableIcon =
    status.mergeable === "MERGEABLE"
      ? { icon: "\u2713", color: "text-green-400" }
      : status.mergeable === "CONFLICTING"
        ? { icon: "\u2717", color: "text-red-400" }
        : { icon: "?", color: "text-yellow-400" };

  const stateIcon =
    status.merge_state_status === "CLEAN"
      ? { icon: "\u2713", color: "text-green-400" }
      : status.merge_state_status === "BLOCKED"
        ? { icon: "\u2717", color: "text-red-400" }
        : status.merge_state_status === "BEHIND"
          ? { icon: "\u2193", color: "text-yellow-400" }
          : { icon: "\u2022", color: "text-zinc-400" };

  const reviewIcon = !status.review_decision
    ? { icon: "\u2014", color: "text-zinc-600" }
    : status.review_decision === "APPROVED"
      ? { icon: "\u2713", color: "text-green-400" }
      : status.review_decision === "CHANGES_REQUESTED"
        ? { icon: "\u2717", color: "text-orange-400" }
        : { icon: "\u25CB", color: "text-yellow-400" };

  const ciIcon = !status.check_status
    ? { icon: "\u2014", color: "text-zinc-600" }
    : status.check_status === "SUCCESS"
      ? { icon: "\u2713", color: "text-green-400" }
      : status.check_status === "FAILURE"
        ? { icon: "\u2717", color: "text-red-400" }
        : { icon: "\u25CB", color: "text-yellow-400" };

  return (
    <div className="flex flex-col gap-3">
      {[
        { label: "Mergeable", value: status.mergeable, ...mergeableIcon },
        { label: "Merge state", value: status.merge_state_status, ...stateIcon },
        {
          label: "Review",
          value: status.review_decision ?? "none",
          ...reviewIcon,
        },
        { label: "CI", value: status.check_status ?? "none", ...ciIcon },
      ].map((item) => (
        <div
          key={item.label}
          className="flex items-center gap-3 rounded bg-white/[0.03] px-3 py-2 text-sm"
        >
          <span className={`text-base ${item.color}`}>{item.icon}</span>
          <span className="text-zinc-400">{item.label}</span>
          <span className="ml-auto font-mono text-xs text-zinc-300">{item.value}</span>
        </div>
      ))}
    </div>
  );
}

// Sub-view: CI failure log output
function CiLogView({ projectPath, runId }: { projectPath: string; runId: number }) {
  const [logData, setLogData] = useState<CiFailureLog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const preRef = useRef<HTMLPreElement>(null);

  const fetchLog = useCallback(async () => {
    try {
      const data = await api.getCiFailureLog(projectPath, runId);
      setLogData(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load CI log");
    } finally {
      setLoading(false);
    }
  }, [projectPath, runId]);

  useEffect(() => {
    setLoading(true);
    fetchLog();
  }, [fetchLog]);

  useEffect(() => {
    const interval = setInterval(fetchLog, 30_000);
    return () => clearInterval(interval);
  }, [fetchLog]);

  if (loading) return <div className="text-sm text-zinc-500">Loading CI log...</div>;
  if (error) return <div className="text-sm text-red-400">{error}</div>;
  if (!logData?.log_text) return <div className="text-sm text-zinc-500">No log output</div>;

  return (
    <pre
      ref={preRef}
      className="max-w-full overflow-auto rounded-lg bg-zinc-900/80 p-4 text-[11px] leading-relaxed font-mono text-zinc-300"
    >
      {stripAnsi(logData.log_text)}
    </pre>
  );
}

// Detail panel shown between the graph and ActionPanel
export function DetailPanel({
  view,
  projectPath,
  activeNode,
  branches,
  onClose,
}: DetailPanelProps) {
  return (
    <div className="min-w-[480px] flex-[2] overflow-hidden flex flex-col border-l border-white/5 bg-black/20">
      {/* Header */}
      <div className="shrink-0 flex items-center gap-2 border-b border-white/5 px-4 py-2">
        <h3 className="flex-1 text-sm font-semibold text-zinc-100 truncate">{viewTitle(view)}</h3>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded p-1 text-zinc-500 transition-colors hover:bg-white/10 hover:text-zinc-200"
          title="Close detail panel"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <title>Close</title>
            <path
              d="M3.5 3.5L10.5 10.5M10.5 3.5L3.5 10.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto p-4">
        {view.kind === "diff" && (
          <DiffView projectPath={projectPath} activeNode={activeNode} branches={branches} />
        )}
        {view.kind === "pr-comments" && (
          <PrCommentsView projectPath={projectPath} prNumber={view.prNumber} />
        )}
        {view.kind === "pr-files" && (
          <PrFilesView projectPath={projectPath} prNumber={view.prNumber} />
        )}
        {view.kind === "merge-status" && (
          <MergeStatusView projectPath={projectPath} prNumber={view.prNumber} />
        )}
        {view.kind === "ci-log" && <CiLogView projectPath={projectPath} runId={view.runId} />}
      </div>
    </div>
  );
}
