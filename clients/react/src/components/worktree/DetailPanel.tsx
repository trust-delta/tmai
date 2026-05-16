import { useCallback, useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  api,
  type BranchListResponse,
  type CiFailureLog,
  type PrChangedFile,
  type PrComment,
  type PrMergeStatus,
  type WorktreeDiffResponse,
} from "@/lib/api";

const proseClassName = `prose prose-invert prose-sm max-w-none
  prose-headings:text-foreground prose-headings:font-semibold
  prose-p:text-foreground prose-p:leading-relaxed
  prose-a:text-info prose-a:no-underline hover:prose-a:underline
  prose-strong:text-foreground
  prose-code:text-primary prose-code:bg-surface prose-code:rounded prose-code:px-1 prose-code:py-0.5 prose-code:text-xs prose-code:before:content-none prose-code:after:content-none
  prose-pre:bg-surface-strong/50 prose-pre:border prose-pre:border-hairline prose-pre:rounded-lg
  prose-li:text-foreground
  prose-th:text-foreground prose-th:border-hairline-strong
  prose-td:text-muted-foreground prose-td:border-hairline-strong
  prose-hr:border-hairline-strong
  prose-blockquote:border-info/30 prose-blockquote:text-muted-foreground`;

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

  if (loading) return <div className="text-sm text-muted-foreground">Loading diff...</div>;
  if (error) return <div className="text-sm text-destructive">{error}</div>;
  if (!diffData?.diff) return <div className="text-sm text-muted-foreground">No changes</div>;
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

  if (loading) return <div className="text-sm text-muted-foreground">Loading comments...</div>;
  if (error) return <div className="text-sm text-destructive">{error}</div>;
  if (comments.length === 0)
    return <div className="text-sm text-muted-foreground">No comments</div>;

  return (
    <div className="flex flex-col gap-4">
      {comments.map((comment) => (
        <div key={comment.url} className="rounded-lg border border-hairline bg-surface p-3">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-semibold text-foreground">{comment.author}</span>
            <span className="text-subtle-foreground">{formatRelative(comment.created_at)}</span>
            {comment.comment_type !== "comment" && (
              <span className="rounded bg-info/15 px-1 py-0.5 text-[10px] text-info">
                {comment.comment_type}
              </span>
            )}
          </div>
          {/* Review comment: show file path and diff hunk context */}
          {comment.path && (
            <div className="mt-2 rounded bg-surface-strong/50 px-2 py-1.5">
              <div className="text-[11px] font-mono text-muted-foreground">{comment.path}</div>
              {comment.diff_hunk && (
                <pre className="mt-1 text-[10px] leading-relaxed text-subtle-foreground overflow-x-auto">
                  {comment.diff_hunk}
                </pre>
              )}
            </div>
          )}
          <div className={`mt-2 ${proseClassName}`}>
            <Markdown remarkPlugins={[remarkGfm]}>{comment.body}</Markdown>
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

  if (loading) return <div className="text-sm text-muted-foreground">Loading files...</div>;
  if (error) return <div className="text-sm text-destructive">{error}</div>;
  if (files.length === 0)
    return <div className="text-sm text-muted-foreground">No changed files</div>;

  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  const totalAdd = sorted.reduce((sum, f) => sum + f.additions, 0);
  const totalDel = sorted.reduce((sum, f) => sum + f.deletions, 0);

  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs text-muted-foreground">
        {sorted.length} file{sorted.length !== 1 ? "s" : ""} changed:{" "}
        <span className="text-success">+{totalAdd}</span>{" "}
        <span className="text-destructive">-{totalDel}</span>
      </div>
      <div className="flex flex-col gap-1">
        {sorted.map((file) => (
          <div
            key={file.path}
            className="flex items-center gap-2 rounded bg-surface px-3 py-1.5 text-xs"
          >
            <span className="flex-1 break-all font-mono text-foreground">{file.path}</span>
            <span className="shrink-0 text-success">+{file.additions}</span>
            <span className="shrink-0 text-destructive">-{file.deletions}</span>
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

  if (loading) return <div className="text-sm text-muted-foreground">Loading merge status...</div>;
  if (error) return <div className="text-sm text-destructive">{error}</div>;
  if (!status) return <div className="text-sm text-muted-foreground">No data</div>;

  // Determine icon and color for each check item
  const mergeableIcon =
    status.mergeable === "MERGEABLE"
      ? { icon: "\u2713", color: "text-success" }
      : status.mergeable === "CONFLICTING"
        ? { icon: "\u2717", color: "text-destructive" }
        : { icon: "?", color: "text-warning" };

  const stateIcon =
    status.merge_state_status === "CLEAN"
      ? { icon: "\u2713", color: "text-success" }
      : status.merge_state_status === "BLOCKED"
        ? { icon: "\u2717", color: "text-destructive" }
        : status.merge_state_status === "BEHIND"
          ? { icon: "\u2193", color: "text-warning" }
          : { icon: "\u2022", color: "text-muted-foreground" };

  const reviewIcon = !status.review_decision
    ? { icon: "\u2014", color: "text-subtle-foreground" }
    : status.review_decision === "APPROVED"
      ? { icon: "\u2713", color: "text-success" }
      : status.review_decision === "CHANGES_REQUESTED"
        ? { icon: "\u2717", color: "text-warning" }
        : { icon: "\u25CB", color: "text-warning" };

  const ciIcon = !status.check_status
    ? { icon: "\u2014", color: "text-subtle-foreground" }
    : status.check_status === "SUCCESS"
      ? { icon: "\u2713", color: "text-success" }
      : status.check_status === "FAILURE"
        ? { icon: "\u2717", color: "text-destructive" }
        : { icon: "\u25CB", color: "text-warning" };

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
          className="flex items-center gap-3 rounded bg-surface px-3 py-2 text-sm"
        >
          <span className={`text-base ${item.color}`}>{item.icon}</span>
          <span className="text-muted-foreground">{item.label}</span>
          <span className="ml-auto font-mono text-xs text-foreground">{item.value}</span>
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

  if (loading) return <div className="text-sm text-muted-foreground">Loading CI log...</div>;
  if (error) return <div className="text-sm text-destructive">{error}</div>;
  if (!logData?.log_text) return <div className="text-sm text-muted-foreground">No log output</div>;

  return (
    <pre
      ref={preRef}
      className="max-w-full overflow-auto rounded-lg bg-surface-strong/80 p-4 text-[11px] leading-relaxed font-mono text-foreground"
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
    <div className="min-w-[480px] flex-[2] overflow-hidden flex flex-col border-l border-hairline bg-background">
      {/* Header */}
      <div className="shrink-0 flex items-center gap-2 border-b border-hairline px-4 py-2">
        <h3 className="flex-1 text-sm font-semibold text-foreground truncate">{viewTitle(view)}</h3>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-surface-strong hover:text-foreground"
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
