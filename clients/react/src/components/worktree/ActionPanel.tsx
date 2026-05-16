import { memo, useCallback, useEffect, useState } from "react";
import { useConfirm } from "@/components/layout/ConfirmDialog";
import {
  api,
  type BranchListResponse,
  type CiSummary,
  type IssueInfo,
  type PrInfo,
} from "@/lib/api";
import { extractIssueNumbers, extractIssueRefs } from "@/lib/issue-utils";
import { branchStateBadgeClass, branchStateLabel, deriveBranchState } from "./branch-state";
import { CreateWorktreeForm } from "./CreateWorktreeForm";
import type { DetailView } from "./DetailPanel";
import type { BranchNode } from "./graph/types";
import { PrCard } from "./PrCard";

interface ActionPanelProps {
  activeNode: BranchNode;
  branches: BranchListResponse | null;
  projectPath: string;
  nodeDepth: Map<string, number>;
  branchDepthWarning: number;
  prInfo: PrInfo | undefined;
  targetPrs: PrInfo[];
  issues: IssueInfo[];
  onRefresh: () => void;
  onSelectNode: (name: string | null) => void;
  onFocusAgent: (target: string) => void;
  onOpenDetail: (view: DetailView | null) => void;
  /** Navigate to issue in Issues tab */
  onNavigateToIssue?: (issue: IssueInfo) => void;
  /** Navigate to branch in Branches tab (used from PrCard) */
  onNavigateToBranch?: (branch: string) => void;
}

// Right-side action panel for the selected branch (Branches tab). Wrapped
// in React.memo so the 1–2 Hz `agents` SSE churn (Claude Code spinner-glyph
// animation) doesn't repeat this ~1000-line widget's render on every parent
// tick. Parent (BranchGraph) passes memoized props (activeNode / nodeDepth /
// targetPrs via a stable EMPTY_PRS fallback) so shallow equality holds on
// quiet ticks.
//
// The Issues-tab counterpart lives in `IssueActionView` — issue and branch
// flows used to share this component via an `issueMode` prop, but the
// surface area was completely disjoint, so they were split (#TBD).
export const ActionPanel = memo(function ActionPanel({
  activeNode,
  branches,
  projectPath,
  nodeDepth,
  branchDepthWarning,
  prInfo,
  targetPrs,
  issues,
  onRefresh,
  onSelectNode,
  onFocusAgent,
  onOpenDetail,
  onNavigateToIssue,
  onNavigateToBranch,
}: ActionPanelProps) {
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [forceDelete, setForceDelete] = useState(false);
  const [deleteRemote, setDeleteRemote] = useState(true);
  const [showNewWorktree, setShowNewWorktree] = useState(false);
  const [ciSummary, setCiSummary] = useState<CiSummary | null>(null);
  const [ciLoading, setCiLoading] = useState(false);
  const [ciExpanded, setCiExpanded] = useState(false);
  const [rerunBusy, setRerunBusy] = useState(false);
  const [branchDiffStat, setBranchDiffStat] = useState<{
    files_changed: number;
    insertions: number;
    deletions: number;
  } | null>(null);

  // Reset all ephemeral state when branch changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional reset on branch name change
  useEffect(() => {
    setActionBusy(false);
    setActionError(null);
    setConfirmDelete(false);
    setForceDelete(false);
    setDeleteRemote(true);
    setShowNewWorktree(false);
  }, [activeNode.name]);

  // Fetch CI checks when branch changes
  useEffect(() => {
    setCiSummary(null);
    setCiExpanded(false);
    if (!activeNode.name) return;
    setCiLoading(true);
    api
      .listChecks(projectPath, activeNode.name)
      .then((data) => {
        setCiSummary(data);
        // Auto-expand CI checks when there are failures
        if (data && data.rollup === "FAILURE") {
          setCiExpanded(true);
        }
      })
      .catch(() => setCiSummary(null))
      .finally(() => setCiLoading(false));
  }, [activeNode.name, projectPath]);

  // Fetch diff stat vs parent branch when branch changes (for non-main branches without worktree diffSummary)
  useEffect(() => {
    setBranchDiffStat(null);
    if (activeNode.isMain || activeNode.diffSummary) return;
    const base = activeNode.parent ?? branches?.default_branch ?? "main";
    api
      .gitDiffStat(projectPath, activeNode.name, base)
      .then((stat) => setBranchDiffStat(stat))
      .catch(() => setBranchDiffStat(null));
  }, [
    activeNode.name,
    activeNode.isMain,
    activeNode.diffSummary,
    activeNode.parent,
    branches?.default_branch,
    projectPath,
  ]);

  // Focus parent or HEAD after deletion
  const focusAfterDelete = useCallback(() => {
    const target =
      activeNode.parent ?? branches?.current_branch ?? branches?.default_branch ?? "main";
    onSelectNode(target);
  }, [activeNode.parent, branches, onSelectNode]);

  const handleLaunchAgent = useCallback(async () => {
    if (!activeNode.worktree || actionBusy) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await api.launchWorktreeAgent(activeNode.worktree.repo_path, activeNode.worktree.name);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to launch agent");
    } finally {
      setActionBusy(false);
    }
  }, [activeNode.worktree, actionBusy]);

  const handleDeleteWorktree = useCallback(async () => {
    if (!activeNode.worktree || actionBusy) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await api.deleteWorktree(
        activeNode.worktree.repo_path,
        activeNode.worktree.name,
        forceDelete,
      );
      focusAfterDelete();
      onRefresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to delete worktree");
    } finally {
      setActionBusy(false);
    }
  }, [activeNode.worktree, actionBusy, forceDelete, focusAfterDelete, onRefresh]);

  const handleDeleteBranch = useCallback(async () => {
    if (actionBusy) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await api.deleteBranch(projectPath, activeNode.name, forceDelete, deleteRemote);
      focusAfterDelete();
      onRefresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to delete branch");
    } finally {
      setActionBusy(false);
    }
  }, [
    actionBusy,
    projectPath,
    activeNode.name,
    forceDelete,
    deleteRemote,
    focusAfterDelete,
    onRefresh,
  ]);

  // Checkout a remote-only branch (creates local tracking branch)
  const handleCheckoutRemote = useCallback(async () => {
    if (actionBusy) return;
    setActionBusy(true);
    setActionError(null);
    try {
      // Extract short name from "origin/branch-name"
      const shortName = activeNode.name.includes("/")
        ? activeNode.name.split("/").slice(1).join("/")
        : activeNode.name;
      await api.checkoutBranch(projectPath, shortName);
      onRefresh();
      onSelectNode(shortName);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to checkout branch");
    } finally {
      setActionBusy(false);
    }
  }, [actionBusy, projectPath, activeNode.name, onRefresh, onSelectNode]);

  // Move current branch into a worktree and checkout default branch
  const handleMoveToWorktree = useCallback(async () => {
    if (actionBusy) return;
    setActionBusy(true);
    setActionError(null);
    try {
      const defBranch = branches?.default_branch ?? "main";
      await api.moveToWorktree(projectPath, activeNode.name, defBranch);
      onRefresh();
      onSelectNode(activeNode.name);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to move branch to worktree");
    } finally {
      setActionBusy(false);
    }
  }, [actionBusy, projectPath, activeNode.name, branches?.default_branch, onRefresh, onSelectNode]);

  // Resolve the base branch for merge/PR operations
  const baseBranch = activeNode.parent ?? branches?.default_branch ?? "main";

  // Warn before destructive actions while an agent is active on this branch
  const confirm = useConfirm();
  const agentActive = activeNode.hasAgent;
  const confirmIfAgentActive = async (action: string, fn: () => void) => {
    if (agentActive) {
      const ok = await confirm({
        title: "Agent Active",
        message: `An agent is already active here. ${action} anyway?`,
        confirmLabel: action,
        variant: "danger",
      });
      if (!ok) return;
    }
    fn();
  };

  // AI delegation
  const delegateToAi = useCallback(
    async (prompt: string) => {
      if (actionBusy) return;
      setActionBusy(true);
      setActionError(null);
      try {
        await api.spawnPty({
          command: "claude",
          args: [prompt],
          cwd: projectPath,
        });
      } catch (e) {
        setActionError(e instanceof Error ? e.message : "Failed to launch agent");
      } finally {
        setActionBusy(false);
      }
    },
    [actionBusy, projectPath],
  );

  // Worktree form callbacks
  const handleWorktreeCreated = useCallback(() => {
    setShowNewWorktree(false);
    onRefresh();
  }, [onRefresh]);

  const handleWorktreeCancel = useCallback(() => {
    setShowNewWorktree(false);
  }, []);

  // Re-run failed CI checks
  const handleRerunFailed = useCallback(async () => {
    if (!ciSummary || rerunBusy) return;
    const failedRunIds = ciSummary.checks
      .filter((c) => c.conclusion === "failure" && c.run_id != null)
      .map((c) => c.run_id as number);
    if (failedRunIds.length === 0) return;
    setRerunBusy(true);
    try {
      await Promise.all(failedRunIds.map((id) => api.rerunFailedChecks(projectPath, id)));
      // Re-fetch CI after a short delay for status to update
      setTimeout(() => {
        api
          .listChecks(projectPath, activeNode.name)
          .then((data) => {
            setCiSummary(data);
            if (data && data.rollup === "FAILURE") setCiExpanded(true);
          })
          .catch(() => {});
      }, 2000);
    } catch {
      setActionError("Failed to re-run checks");
    } finally {
      setRerunBusy(false);
    }
  }, [ciSummary, rerunBusy, projectPath, activeNode.name]);

  return (
    <div className="w-80 shrink-0 overflow-y-auto border-l border-hairline bg-background">
      <div className="p-4">
        {/* Node info header */}
        <div className="mb-4">
          <div className="flex items-center gap-2">
            {activeNode.isWorktree && <span className="text-sm">🌿</span>}
            <h3 className="text-sm font-semibold text-foreground">{activeNode.name}</h3>
            {activeNode.lastCommitTime != null && (
              <span
                className={`text-[10px] ${(() => {
                  const days = Math.floor((Date.now() / 1000 - activeNode.lastCommitTime) / 86400);
                  if (days <= 3) return "text-muted-foreground";
                  if (days <= 14) return "text-warning/70";
                  return "text-destructive/70";
                })()}`}
              >
                {(() => {
                  const diff = Math.floor(Date.now() / 1000 - activeNode.lastCommitTime);
                  if (diff < 60) return "just now";
                  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
                  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
                  const days = Math.floor(diff / 86400);
                  if (days < 14) return `${days}d ago`;
                  return `${Math.floor(days / 7)}w ago`;
                })()}
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap gap-2 text-[11px]">
            {activeNode.isMain && (
              <span className="rounded bg-success/15 px-1.5 py-0.5 text-success">default</span>
            )}
            {activeNode.isWorktree && (
              <span className="rounded bg-success/15 px-1.5 py-0.5 text-success">worktree</span>
            )}
            {activeNode.isCurrent && (
              <span className="rounded bg-primary/15 px-1.5 py-0.5 text-primary">HEAD</span>
            )}
            {activeNode.hasAgent && (
              <span className="rounded bg-primary/15 px-1.5 py-0.5 text-primary">
                {activeNode.agentStatus || "active"}
              </span>
            )}
            {activeNode.isDirty && (
              <span className="rounded bg-warning/15 px-1.5 py-0.5 text-warning">modified</span>
            )}
            {/* Branch lifecycle state badge */}
            {(() => {
              const state = deriveBranchState(activeNode, prInfo);
              const label = branchStateLabel(state);
              if (!label) return null;
              return (
                <span className={`rounded px-1.5 py-0.5 ${branchStateBadgeClass(state)}`}>
                  {label}
                </span>
              );
            })()}
          </div>
          {(() => {
            const ds = activeNode.diffSummary ?? branchDiffStat;
            if (!ds) return null;
            return (
              <div className="mt-2 text-xs text-muted-foreground">
                <span className="text-success">+{ds.insertions}</span>{" "}
                <span className="text-destructive">-{ds.deletions}</span>
                {" \u00B7 "}
                {ds.files_changed} file{ds.files_changed !== 1 ? "s" : ""}
              </div>
            );
          })()}
          {/* Remote tracking info */}
          {activeNode.remote ? (
            <div className="mt-2 rounded bg-surface px-2 py-1.5 text-[11px]">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <span className="text-subtle-foreground">remote:</span>
                <span className="font-mono text-muted-foreground">
                  {activeNode.remote.remote_branch}
                </span>
              </div>
              <div className="mt-0.5 flex items-center gap-2">
                {activeNode.remote.ahead === 0 && activeNode.remote.behind === 0 ? (
                  <span className="text-muted-foreground">= up to date</span>
                ) : (
                  <>
                    {activeNode.remote.ahead > 0 && (
                      <span className="text-warning">{activeNode.remote.ahead} to push</span>
                    )}
                    {activeNode.remote.behind > 0 && (
                      <span className="text-primary">{activeNode.remote.behind} to pull</span>
                    )}
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="mt-2 text-[11px] text-subtle-foreground">no remote tracking</div>
          )}
          {/* PR info */}
          {prInfo && (
            <div className="mt-2">
              <PrCard
                pr={prInfo}
                onOpenDetail={onOpenDetail}
                onNavigateToIssue={onNavigateToIssue}
                issues={issues}
              />
            </div>
          )}
          {/* CI checks */}
          {ciLoading && (
            <div className="mt-2 text-[11px] text-subtle-foreground">Loading checks...</div>
          )}
          {ciSummary && ciSummary.checks.length > 0 && (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setCiExpanded((v) => !v)}
                className="flex items-center gap-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              >
                <span
                  className={`inline-block h-2 w-2 rounded-full ${
                    ciSummary.rollup === "SUCCESS"
                      ? "bg-success"
                      : ciSummary.rollup === "FAILURE"
                        ? "bg-destructive"
                        : ciSummary.rollup === "PENDING"
                          ? "bg-warning"
                          : "bg-muted-foreground"
                  }`}
                />
                <span>
                  CI{" "}
                  {ciSummary.rollup === "SUCCESS"
                    ? "passed"
                    : ciSummary.rollup === "FAILURE"
                      ? "failed"
                      : ciSummary.rollup === "PENDING"
                        ? "running"
                        : "unknown"}
                </span>
                <span className="text-[10px] text-subtle-foreground">
                  ({ciSummary.checks.length} check
                  {ciSummary.checks.length !== 1 ? "s" : ""})
                </span>
                <span className="text-[10px]">{ciExpanded ? "\u25BE" : "\u25B8"}</span>
              </button>
              {ciExpanded && (
                <div className="mt-1.5 flex flex-col gap-1">
                  {ciSummary.checks.map((check) => {
                    const isFailed = check.conclusion === "failure";
                    const canViewLog = isFailed && check.run_id != null;
                    return (
                      <button
                        type="button"
                        key={check.name + check.url}
                        onClick={() => {
                          if (canViewLog && check.run_id != null) {
                            onOpenDetail({
                              kind: "ci-log",
                              runId: check.run_id,
                              checkName: check.name,
                            });
                          } else {
                            window.open(check.url, "_blank", "noopener,noreferrer");
                          }
                        }}
                        className="flex items-center gap-1.5 rounded bg-surface px-2 py-1 text-left text-[11px] transition-colors hover:bg-surface"
                      >
                        <span
                          className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                            check.conclusion === "success"
                              ? "bg-success"
                              : check.conclusion === "failure"
                                ? "bg-destructive"
                                : check.status === "in_progress" || check.status === "queued"
                                  ? "bg-warning"
                                  : "bg-muted-foreground"
                          }`}
                        />
                        <span className="truncate text-foreground">{check.name}</span>
                        {canViewLog && (
                          <span className="text-[9px] text-destructive/60" title="View failure log">
                            log
                          </span>
                        )}
                        <span
                          className={`ml-auto shrink-0 text-[10px] ${
                            check.conclusion === "success"
                              ? "text-success"
                              : check.conclusion === "failure"
                                ? "text-destructive"
                                : check.status === "in_progress"
                                  ? "text-warning"
                                  : "text-subtle-foreground"
                          }`}
                        >
                          {check.conclusion ?? check.status}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
              {/* Re-run failed checks button */}
              {ciExpanded &&
                ciSummary.rollup === "FAILURE" &&
                ciSummary.checks.some((c) => c.conclusion === "failure" && c.run_id != null) && (
                  <button
                    type="button"
                    onClick={handleRerunFailed}
                    disabled={rerunBusy}
                    className="mt-1.5 w-full rounded bg-destructive/10 px-2 py-1 text-[11px] text-destructive transition-colors hover:bg-destructive/20 disabled:opacity-50"
                  >
                    {rerunBusy ? "Re-running..." : "Re-run failed checks"}
                  </button>
                )}
            </div>
          )}
          {ciSummary && ciSummary.checks.length === 0 && !ciLoading && !prInfo?.check_status && (
            <div className="mt-2 text-[11px] text-subtle-foreground">No CI checks</div>
          )}
          {/* Linked issues — clickable to navigate to Issues tab */}
          {(() => {
            const nums = extractIssueNumbers(activeNode.name);
            if (prInfo?.title) {
              for (const n of extractIssueRefs(prInfo.title)) {
                if (!nums.includes(n)) nums.push(n);
              }
            }
            const linked = issues.filter((i) => nums.includes(i.number));
            if (linked.length === 0) return null;
            return (
              <div className="mt-2">
                <div className="mb-1 text-[11px] text-muted-foreground">Linked issues</div>
                <div className="flex flex-col gap-1">
                  {linked.map((issue) => (
                    <button
                      key={issue.number}
                      type="button"
                      onClick={() => onNavigateToIssue?.(issue)}
                      className="flex items-start gap-1.5 rounded bg-surface px-2 py-1.5 text-left text-[11px] transition-colors hover:bg-surface"
                      title={`Go to issue #${issue.number}`}
                    >
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 16 16"
                        fill="currentColor"
                        className="mt-0.5 shrink-0 text-success"
                        aria-hidden="true"
                      >
                        <path d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" />
                        <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z" />
                      </svg>
                      <span className="shrink-0 text-success">#{issue.number}</span>
                      <span className="truncate text-foreground">{issue.title}</span>
                      {issue.labels.length > 0 && (
                        <div className="ml-auto flex shrink-0 gap-1">
                          {issue.labels.slice(0, 2).map((label) => (
                            <span
                              key={label.name}
                              className="rounded px-1 py-0.5 text-[9px]"
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
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>

        {/* Incoming PRs (PRs targeting this branch) */}
        {targetPrs.length > 0 && (
          <div className="mb-4">
            <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Incoming PRs ({targetPrs.length})
            </div>
            <div className="flex max-h-96 flex-col gap-1.5 overflow-y-auto pr-1">
              {targetPrs.map((pr) => (
                <PrCard
                  key={pr.number}
                  pr={pr}
                  onOpenDetail={onOpenDetail}
                  showBranchFlow
                  targetBranch={activeNode.name}
                  onNavigateToIssue={onNavigateToIssue}
                  onNavigateToBranch={onNavigateToBranch}
                  issues={issues}
                />
              ))}
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex flex-col gap-2">
          {/* View Diff — available for all non-main branches */}
          {!activeNode.isMain && (
            <button
              type="button"
              onClick={() => onOpenDetail({ kind: "diff" })}
              className="w-full rounded-lg bg-surface px-3 py-2 text-left text-xs text-foreground transition-colors hover:bg-surface-strong"
            >
              View Diff
            </button>
          )}

          {/* Remote-only branch actions */}
          {activeNode.isRemoteOnly && (
            <button
              type="button"
              onClick={handleCheckoutRemote}
              disabled={actionBusy}
              className="w-full rounded-lg bg-accent/15 px-3 py-2 text-left text-xs font-medium text-accent transition-colors hover:bg-accent/25 disabled:opacity-50"
            >
              {actionBusy ? "Checking out..." : "Checkout (Create Local Branch)"}
            </button>
          )}

          {/* Non-main branch/worktree actions (context-aware by branch state) */}
          {!activeNode.isMain &&
            !activeNode.isRemoteOnly &&
            (() => {
              const branchState = deriveBranchState(activeNode, prInfo);
              const isMerged = branchState === "merged";
              const isStale = branchState === "stale";
              const hasOpenPr = branchState === "has-open-pr";

              return (
                <>
                  {/* Merged branch guidance */}
                  {isMerged && (
                    <div className="rounded-lg bg-accent/10 px-3 py-2 text-xs text-accent">
                      This branch has been merged. You can safely delete it.
                    </div>
                  )}

                  {/* Stale branch guidance */}
                  {isStale && (
                    <div className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
                      {activeNode.behind} commit
                      {activeNode.behind !== 1 ? "s" : ""} behind {baseBranch} — pull or rebase
                      before resuming work.
                    </div>
                  )}

                  {/* View PR link — prominent for open PR state */}
                  {hasOpenPr && prInfo && (
                    <a
                      href={prInfo.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block w-full rounded-lg bg-info/15 px-3 py-2 text-left text-xs font-medium text-info transition-colors hover:bg-info/25"
                    >
                      View PR #{prInfo.number} on GitHub
                    </a>
                  )}

                  {/* Focus Agent / Launch Agent — hidden for merged, disabled for stale */}
                  {!isMerged &&
                    (activeNode.agentTarget ? (
                      <button
                        type="button"
                        onClick={() => {
                          if (activeNode.agentTarget) onFocusAgent(activeNode.agentTarget);
                        }}
                        disabled={isStale}
                        className="w-full rounded-lg bg-primary/15 px-3 py-2 text-left text-xs font-medium text-primary transition-colors hover:bg-primary/25 disabled:opacity-30"
                        title={isStale ? "Pull from main before focusing agent" : undefined}
                      >
                        Focus Agent
                      </button>
                    ) : (
                      activeNode.isWorktree &&
                      activeNode.worktree && (
                        <button
                          type="button"
                          onClick={() => confirmIfAgentActive("Launch agent", handleLaunchAgent)}
                          disabled={actionBusy || isStale}
                          className="w-full rounded-lg bg-primary/15 px-3 py-2 text-left text-xs font-medium text-primary transition-colors hover:bg-primary/25 disabled:opacity-30"
                          title={isStale ? "Pull from main before launching agent" : undefined}
                        >
                          {actionBusy ? "Launching..." : "Launch Agent"}
                        </button>
                      )
                    ))}

                  {/* Create PR — hidden for merged and open-PR, disabled for stale.
                      The former "AI Merge" delegation was removed in the Stage-1
                      in-tmai dev-loop: merging now runs directly from the Producer
                      console's "Open PRs" section (POST /api/github/pr/merge), not
                      via a spawned agent — no two coexisting merge paths. */}
                  {!isMerged && !hasOpenPr && activeNode.ahead > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        delegateToAi(
                          `Run 'gh pr create --base ${baseBranch} --head ${activeNode.name}' to create a PR. Generate a title and description summarizing the changes. Do not merge anything.`,
                        )
                      }
                      disabled={actionBusy || isStale}
                      className="w-full rounded-lg bg-info/15 px-3 py-2 text-left text-xs font-medium text-info transition-colors hover:bg-info/25 disabled:opacity-30"
                      title={isStale ? "Pull from main before creating PR" : undefined}
                    >
                      AI Create PR → {baseBranch}
                    </button>
                  )}

                  {/* Behind warning — shown for non-merged branches (prominent in stale already handled above) */}
                  {!isMerged && !isStale && activeNode.behind > 0 && (
                    <div className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
                      {activeNode.behind} commit
                      {activeNode.behind !== 1 ? "s" : ""} behind {baseBranch}
                    </div>
                  )}

                  {/* Move to Worktree — hidden for merged branches */}
                  {!isMerged && !activeNode.isWorktree && activeNode.isCurrent && (
                    <button
                      type="button"
                      onClick={() => confirmIfAgentActive("Move", handleMoveToWorktree)}
                      disabled={actionBusy}
                      className="w-full rounded-lg bg-warning/15 px-3 py-2 text-left text-xs font-medium text-warning transition-colors hover:bg-warning/25 disabled:opacity-50"
                    >
                      {actionBusy ? "Moving..." : "Move to Worktree"}
                    </button>
                  )}

                  {/* Create worktree — hidden for merged branches */}
                  {!isMerged &&
                    !activeNode.isWorktree &&
                    (!showNewWorktree ? (
                      <button
                        type="button"
                        onClick={() => setShowNewWorktree(true)}
                        className="w-full rounded-lg bg-success/15 px-3 py-2 text-left text-xs font-medium text-success transition-colors hover:bg-success/25"
                      >
                        Create Worktree
                      </button>
                    ) : (
                      <CreateWorktreeForm
                        baseBranch={activeNode.name}
                        depth={nodeDepth.get(activeNode.name) ?? 0}
                        depthWarning={branchDepthWarning}
                        projectPath={projectPath}
                        onCreated={handleWorktreeCreated}
                        onCancel={handleWorktreeCancel}
                      />
                    ))}

                  {/* Delete — primary for merged, confirmation-gated for open PR */}
                  <hr className="border-hairline" />
                  {!confirmDelete ? (
                    <button
                      type="button"
                      onClick={() =>
                        hasOpenPr
                          ? confirmIfAgentActive("Delete (PR is open)", () =>
                              setConfirmDelete(true),
                            )
                          : confirmIfAgentActive("Delete", () => setConfirmDelete(true))
                      }
                      disabled={!activeNode.isWorktree && activeNode.isCurrent}
                      className={`w-full rounded-lg px-3 py-2 text-left text-xs transition-colors disabled:opacity-30 ${
                        isMerged
                          ? "bg-destructive/20 font-medium text-destructive hover:bg-destructive/30"
                          : "bg-destructive/10 text-destructive hover:bg-destructive/20"
                      }`}
                    >
                      {isMerged
                        ? `Delete ${activeNode.isWorktree ? "Worktree" : "Branch"} (merged)`
                        : `Delete ${activeNode.isWorktree ? "Worktree" : "Branch"}`}
                    </button>
                  ) : (
                    <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-2">
                      {hasOpenPr && (
                        <div className="mb-2 text-[11px] text-warning">
                          Warning: PR #{prInfo?.number} is still open
                        </div>
                      )}
                      <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={forceDelete}
                          onChange={(e) => setForceDelete(e.target.checked)}
                          className="accent-destructive"
                        />
                        Force delete{!activeNode.isWorktree ? " (unmerged)" : ""}
                      </label>
                      {!activeNode.isWorktree && activeNode.remote && (
                        <label className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={deleteRemote}
                            onChange={(e) => setDeleteRemote(e.target.checked)}
                            className="accent-destructive"
                          />
                          Also delete remote branch
                        </label>
                      )}
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          onClick={
                            activeNode.isWorktree ? handleDeleteWorktree : handleDeleteBranch
                          }
                          disabled={actionBusy}
                          className="rounded bg-destructive/20 px-2 py-1 text-xs text-destructive hover:bg-destructive/30 disabled:opacity-50"
                        >
                          {actionBusy ? "..." : "Confirm"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setConfirmDelete(false);
                            setForceDelete(false);
                            setDeleteRemote(true);
                          }}
                          className="text-xs text-muted-foreground hover:text-foreground"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </>
              );
            })()}

          {/* Main branch actions */}
          {activeNode.isMain &&
            (!showNewWorktree ? (
              <button
                type="button"
                onClick={() => setShowNewWorktree(true)}
                className="w-full rounded-lg bg-success/15 px-3 py-2 text-left text-xs font-medium text-success transition-colors hover:bg-success/25"
              >
                Create Worktree
              </button>
            ) : (
              <CreateWorktreeForm
                baseBranch={activeNode.name}
                depth={0}
                depthWarning={branchDepthWarning}
                projectPath={projectPath}
                onCreated={handleWorktreeCreated}
                onCancel={handleWorktreeCancel}
              />
            ))}
        </div>

        {/* Error display */}
        {actionError && (
          <div className="mt-3 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {actionError}
          </div>
        )}
      </div>
    </div>
  );
});
