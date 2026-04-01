import { useCallback, useEffect, useRef, useState } from "react";
import { useConfirm } from "@/components/layout/ConfirmDialog";
import {
  api,
  type BranchListResponse,
  type CiSummary,
  type IssueInfo,
  type PrInfo,
  type WorktreeSnapshot,
} from "@/lib/api";
import { extractIssueNumbers, extractIssueRefs, issueToWorktreeName } from "@/lib/issue-utils";
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
  // Issue mode (when Issues tab is active)
  issueMode?: boolean;
  selectedIssue?: IssueInfo | null;
  defaultBranch?: string;
  worktrees?: WorktreeSnapshot[];
  onStartWorkDone?: (worktreeName: string) => void;
  onSelectWorktreeBranch?: (branch: string) => void;
}

// Right-side action panel for selected branch
export function ActionPanel({
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
  issueMode,
  selectedIssue,
  defaultBranch,
  worktrees,
  onStartWorkDone,
  onSelectWorktreeBranch,
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
  // Issue start-work form state
  const [startWorkName, setStartWorkName] = useState("");
  const [startWorkBusy, setStartWorkBusy] = useState(false);
  const [startWorkError, setStartWorkError] = useState<string | null>(null);
  const startWorkInputRef = useRef<HTMLInputElement>(null);

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

  // Pre-fill start-work name when issue selection changes
  useEffect(() => {
    if (selectedIssue) {
      setStartWorkName(issueToWorktreeName(selectedIssue));
      setStartWorkError(null);
      setStartWorkBusy(false);
      // Focus the input after render
      setTimeout(() => startWorkInputRef.current?.focus(), 50);
    }
  }, [selectedIssue]);

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

  // Start work on an issue: create worktree + launch agent
  // Build a resolve prompt from the selected issue
  const buildResolvePrompt = useCallback(
    (issue: IssueInfo) =>
      `GitHub Issue #${issue.number} "${issue.title}" に対応してください。\n\nまず \`gh issue view ${issue.number}\` でissueの詳細を確認し、実装方針を立ててください。\n実装・テスト完了後、PRを作成してください（Closes #${issue.number} をPR本文に含めること）。`,
    [],
  );

  // Create worktree + launch agent (optionally with initial prompt)
  const handleStartWork = useCallback(
    async (initialPrompt?: string) => {
      if (!selectedIssue || startWorkBusy || !startWorkName.trim()) return;
      const trimmed = startWorkName.trim();
      if (!/^[a-zA-Z0-9_-]+$/.test(trimmed) || trimmed.length > 64) {
        setStartWorkError("a-z, 0-9, -, _ only (max 64)");
        return;
      }
      setStartWorkBusy(true);
      setStartWorkError(null);
      try {
        const base = defaultBranch ?? "main";
        await api.spawnWorktree({
          name: trimmed,
          cwd: projectPath,
          base_branch: base,
          ...(initialPrompt ? { initial_prompt: initialPrompt } : {}),
        });
        onStartWorkDone?.(trimmed);
      } catch (e) {
        setStartWorkError(e instanceof Error ? e.message : "Failed to create worktree");
      } finally {
        setStartWorkBusy(false);
      }
    },
    [selectedIssue, startWorkBusy, startWorkName, defaultBranch, projectPath, onStartWorkDone],
  );

  // Find matching worktree for selected issue
  const matchingWorktree = (() => {
    if (!selectedIssue || !worktrees) return null;
    for (const wt of worktrees) {
      if (wt.is_main) continue;
      const branch = wt.branch ?? wt.name;
      const nums = extractIssueNumbers(branch);
      if (nums.includes(selectedIssue.number)) return wt;
    }
    return null;
  })();

  // Issue mode: show issue details + start work form (or worktree status)
  if (issueMode) {
    return (
      <div className="w-80 shrink-0 overflow-y-auto border-l border-white/5 bg-black/20">
        <div className="p-4">
          {selectedIssue ? (
            <>
              {/* Issue header */}
              <div className="mb-4">
                <div className="flex items-center gap-2">
                  <span className="text-lg font-semibold text-green-400">
                    #{selectedIssue.number}
                  </span>
                  <a
                    href={selectedIssue.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-zinc-500 hover:text-zinc-300"
                  >
                    open in GitHub
                  </a>
                </div>
                <h3 className="mt-1 text-sm font-medium text-zinc-100">{selectedIssue.title}</h3>
                {/* Labels */}
                {selectedIssue.labels.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {selectedIssue.labels.map((label) => (
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
                {selectedIssue.assignees.length > 0 && (
                  <div className="mt-2 text-[11px] text-zinc-500">
                    Assigned: {selectedIssue.assignees.join(", ")}
                  </div>
                )}
              </div>

              {matchingWorktree ? (
                /* Existing worktree status */
                <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3">
                  <div className="mb-2 text-[11px] font-medium text-cyan-400">
                    {matchingWorktree.agent_status === "in-progress" ||
                    matchingWorktree.agent_status === "waiting"
                      ? "Agent In Progress"
                      : "Worktree Exists"}
                  </div>
                  <div className="mb-1 text-[11px] text-zinc-400">
                    <span className="text-zinc-500">branch:</span>{" "}
                    <span className="text-cyan-400">
                      {matchingWorktree.branch ?? matchingWorktree.name}
                    </span>
                  </div>
                  {matchingWorktree.agent_target && (
                    <div className="mb-1 text-[11px] text-zinc-400">
                      <span className="text-zinc-500">agent:</span>{" "}
                      <span className="text-cyan-400">{matchingWorktree.agent_target}</span>
                    </div>
                  )}
                  {matchingWorktree.agent_status && (
                    <div className="mb-2 text-[11px] text-zinc-400">
                      <span className="text-zinc-500">status:</span>{" "}
                      <span
                        className={
                          matchingWorktree.agent_status === "in-progress" ||
                          matchingWorktree.agent_status === "waiting"
                            ? "text-cyan-400"
                            : "text-amber-400"
                        }
                      >
                        {matchingWorktree.agent_status}
                      </span>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      const branch = matchingWorktree.branch ?? matchingWorktree.name;
                      onSelectWorktreeBranch?.(branch);
                    }}
                    className="mt-1 w-full rounded-lg bg-cyan-500/20 px-3 py-2 text-xs font-medium text-cyan-400 transition-colors hover:bg-cyan-500/30"
                  >
                    Go to Worktree
                  </button>
                </div>
              ) : (
                /* Start Work form */
                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                  <div className="mb-2 text-[11px] font-medium text-emerald-400">Start Work</div>
                  <div className="mb-1.5 text-[11px] text-zinc-500">
                    base: <span className="text-emerald-400">{defaultBranch ?? "main"}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <input
                      ref={startWorkInputRef}
                      type="text"
                      value={startWorkName}
                      onChange={(e) => {
                        setStartWorkName(e.target.value);
                        setStartWorkError(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleStartWork();
                      }}
                      placeholder="worktree name"
                      className="flex-1 rounded bg-black/30 px-2 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none ring-1 ring-emerald-500/30 focus:ring-emerald-500/60"
                    />
                  </div>
                  <div className="mt-1 text-[10px] text-zinc-600">
                    Creates worktree + launches agent
                  </div>
                  {startWorkError && (
                    <div className="mt-1 text-[10px] text-red-400">{startWorkError}</div>
                  )}
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleStartWork()}
                      disabled={!startWorkName.trim() || startWorkBusy}
                      className="flex-1 rounded-lg bg-emerald-500/20 px-3 py-2 text-xs font-medium text-emerald-400 transition-colors hover:bg-emerald-500/30 disabled:opacity-40"
                    >
                      {startWorkBusy ? "Creating..." : "Launch Agent"}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        selectedIssue && handleStartWork(buildResolvePrompt(selectedIssue))
                      }
                      disabled={!startWorkName.trim() || startWorkBusy}
                      className="flex-1 rounded-lg bg-amber-500/20 px-3 py-2 text-xs font-medium text-amber-400 transition-colors hover:bg-amber-500/30 disabled:opacity-40"
                      title="Worktree作成 → issue内容を含むプロンプトでエージェント起動 → 実装・テスト・PR作成まで自動実行"
                    >
                      {startWorkBusy ? "Creating..." : "Create & Resolve ▶"}
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-sm text-zinc-500">Select an issue to start work</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="w-80 shrink-0 overflow-y-auto border-l border-white/5 bg-black/20">
      <div className="p-4">
        {/* Node info header */}
        <div className="mb-4">
          <div className="flex items-center gap-2">
            {activeNode.isWorktree && <span className="text-sm">🌿</span>}
            <h3 className="text-sm font-semibold text-zinc-100">{activeNode.name}</h3>
          </div>
          <div className="mt-1 flex flex-wrap gap-2 text-[11px]">
            {activeNode.isMain && (
              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-400">
                default
              </span>
            )}
            {activeNode.isWorktree && (
              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-400">
                worktree
              </span>
            )}
            {activeNode.isCurrent && (
              <span className="rounded bg-cyan-500/15 px-1.5 py-0.5 text-cyan-400">HEAD</span>
            )}
            {activeNode.hasAgent && (
              <span className="rounded bg-cyan-500/15 px-1.5 py-0.5 text-cyan-400">
                {activeNode.agentStatus || "active"}
              </span>
            )}
            {activeNode.isDirty && (
              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-400">modified</span>
            )}
          </div>
          {(() => {
            const ds = activeNode.diffSummary ?? branchDiffStat;
            if (!ds) return null;
            return (
              <div className="mt-2 text-xs text-zinc-500">
                <span className="text-emerald-400">+{ds.insertions}</span>{" "}
                <span className="text-red-400">-{ds.deletions}</span>
                {" \u00B7 "}
                {ds.files_changed} file{ds.files_changed !== 1 ? "s" : ""}
              </div>
            );
          })()}
          {/* Remote tracking info */}
          {activeNode.remote ? (
            <div className="mt-2 rounded bg-white/[0.03] px-2 py-1.5 text-[11px]">
              <div className="flex items-center gap-1.5 text-zinc-500">
                <span className="text-zinc-600">remote:</span>
                <span className="font-mono text-zinc-400">{activeNode.remote.remote_branch}</span>
              </div>
              <div className="mt-0.5 flex items-center gap-2">
                {activeNode.remote.ahead === 0 && activeNode.remote.behind === 0 ? (
                  <span className="text-zinc-500">= up to date</span>
                ) : (
                  <>
                    {activeNode.remote.ahead > 0 && (
                      <span className="text-amber-400">{activeNode.remote.ahead} to push</span>
                    )}
                    {activeNode.remote.behind > 0 && (
                      <span className="text-cyan-400">{activeNode.remote.behind} to pull</span>
                    )}
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="mt-2 text-[11px] text-zinc-600">no remote tracking</div>
          )}
          {/* PR info */}
          {prInfo && (
            <div className="mt-2">
              <PrCard pr={prInfo} onOpenDetail={onOpenDetail} />
            </div>
          )}
          {/* CI checks */}
          {ciLoading && <div className="mt-2 text-[11px] text-zinc-600">Loading checks...</div>}
          {ciSummary && ciSummary.checks.length > 0 && (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setCiExpanded((v) => !v)}
                className="flex items-center gap-1.5 text-[11px] text-zinc-400 transition-colors hover:text-zinc-200"
              >
                <span
                  className={`inline-block h-2 w-2 rounded-full ${
                    ciSummary.rollup === "SUCCESS"
                      ? "bg-green-400"
                      : ciSummary.rollup === "FAILURE"
                        ? "bg-red-400"
                        : ciSummary.rollup === "PENDING"
                          ? "bg-yellow-400"
                          : "bg-zinc-600"
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
                <span className="text-[10px] text-zinc-600">
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
                        className="flex items-center gap-1.5 rounded bg-white/[0.03] px-2 py-1 text-left text-[11px] transition-colors hover:bg-white/[0.06]"
                      >
                        <span
                          className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                            check.conclusion === "success"
                              ? "bg-green-400"
                              : check.conclusion === "failure"
                                ? "bg-red-400"
                                : check.status === "in_progress" || check.status === "queued"
                                  ? "bg-yellow-400"
                                  : "bg-zinc-600"
                          }`}
                        />
                        <span className="truncate text-zinc-300">{check.name}</span>
                        {canViewLog && (
                          <span className="text-[9px] text-red-400/60" title="View failure log">
                            log
                          </span>
                        )}
                        <span
                          className={`ml-auto shrink-0 text-[10px] ${
                            check.conclusion === "success"
                              ? "text-green-400"
                              : check.conclusion === "failure"
                                ? "text-red-400"
                                : check.status === "in_progress"
                                  ? "text-yellow-400"
                                  : "text-zinc-600"
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
                    className="mt-1.5 w-full rounded bg-red-500/10 px-2 py-1 text-[11px] text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-50"
                  >
                    {rerunBusy ? "Re-running..." : "Re-run failed checks"}
                  </button>
                )}
            </div>
          )}
          {ciSummary && ciSummary.checks.length === 0 && !ciLoading && !prInfo?.check_status && (
            <div className="mt-2 text-[11px] text-zinc-600">No CI checks</div>
          )}
          {/* Linked issues */}
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
                <div className="mb-1 text-[11px] text-zinc-500">Linked issues</div>
                <div className="flex flex-col gap-1">
                  {linked.map((issue) => (
                    <a
                      key={issue.number}
                      href={issue.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-start gap-1.5 rounded bg-white/[0.03] px-2 py-1.5 text-[11px] transition-colors hover:bg-white/[0.06]"
                    >
                      <span className="shrink-0 text-green-400">#{issue.number}</span>
                      <span className="truncate text-zinc-300">{issue.title}</span>
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
                    </a>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>

        {/* Incoming PRs (PRs targeting this branch) */}
        {targetPrs.length > 0 && (
          <div className="mb-4">
            <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
              Incoming PRs
            </div>
            <div className="flex flex-col gap-1.5">
              {targetPrs.map((pr) => (
                <PrCard
                  key={pr.number}
                  pr={pr}
                  onOpenDetail={onOpenDetail}
                  showBranchFlow
                  targetBranch={activeNode.name}
                  onAiMerge={() =>
                    confirmIfAgentActive("Merge", () =>
                      delegateToAi(
                        `Merge PR #${pr.number}. First run 'gh pr view ${pr.number} --json baseRefName -q .baseRefName' to verify base is '${activeNode.name}'. If base matches, run 'gh pr merge ${pr.number} --squash --delete-branch'. If base does NOT match, STOP and report the mismatch — do not merge.`,
                      ),
                    )
                  }
                  actionBusy={actionBusy}
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
              className="w-full rounded-lg bg-white/5 px-3 py-2 text-left text-xs text-zinc-300 transition-colors hover:bg-white/10"
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
              className="w-full rounded-lg bg-purple-500/15 px-3 py-2 text-left text-xs font-medium text-purple-400 transition-colors hover:bg-purple-500/25 disabled:opacity-50"
            >
              {actionBusy ? "Checking out..." : "Checkout (Create Local Branch)"}
            </button>
          )}

          {/* Non-main branch/worktree actions (unified) */}
          {!activeNode.isMain && !activeNode.isRemoteOnly && (
            <>
              {/* Focus Agent (worktree or any branch with agent) */}
              {activeNode.agentTarget ? (
                <button
                  type="button"
                  onClick={() => {
                    if (activeNode.agentTarget) onFocusAgent(activeNode.agentTarget);
                  }}
                  className="w-full rounded-lg bg-cyan-500/15 px-3 py-2 text-left text-xs font-medium text-cyan-400 transition-colors hover:bg-cyan-500/25"
                >
                  Focus Agent
                </button>
              ) : (
                activeNode.isWorktree &&
                activeNode.worktree && (
                  <button
                    type="button"
                    onClick={() => confirmIfAgentActive("Launch agent", handleLaunchAgent)}
                    disabled={actionBusy}
                    className="w-full rounded-lg bg-cyan-500/15 px-3 py-2 text-left text-xs font-medium text-cyan-400 transition-colors hover:bg-cyan-500/25 disabled:opacity-50"
                  >
                    {actionBusy ? "Launching..." : "Launch Agent"}
                  </button>
                )
              )}

              {/* Merge into parent / Create PR */}
              {activeNode.ahead > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      confirmIfAgentActive("Merge", () =>
                        delegateToAi(
                          prInfo
                            ? `Merge PR #${prInfo.number}. First run 'gh pr view ${prInfo.number} --json baseRefName -q .baseRefName' to verify base is '${baseBranch}'. If base matches, run 'gh pr merge ${prInfo.number} --squash --delete-branch'. If base does NOT match, STOP and report the mismatch — do not merge.`
                            : `Merge branch '${activeNode.name}' into '${baseBranch}'. First check 'gh pr list --head ${activeNode.name} --base ${baseBranch}'. If PR exists and its base is '${baseBranch}', run 'gh pr merge <number> --squash --delete-branch'. If no PR, run 'git checkout ${baseBranch} && git merge ${activeNode.name}'. Do not merge into any branch other than '${baseBranch}'.`,
                        ),
                      )
                    }
                    disabled={actionBusy}
                    className="w-full rounded-lg bg-purple-500/15 px-3 py-2 text-left text-xs font-medium text-purple-400 transition-colors hover:bg-purple-500/25 disabled:opacity-50"
                  >
                    {prInfo
                      ? `AI Merge PR #${prInfo.number} into ${baseBranch}`
                      : `AI Merge into ${baseBranch}`}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      delegateToAi(
                        `Run 'gh pr create --base ${baseBranch} --head ${activeNode.name}' to create a PR. Generate a title and description summarizing the changes. Do not merge anything.`,
                      )
                    }
                    disabled={actionBusy}
                    className="w-full rounded-lg bg-blue-500/15 px-3 py-2 text-left text-xs font-medium text-blue-400 transition-colors hover:bg-blue-500/25 disabled:opacity-50"
                  >
                    AI Create PR → {baseBranch}
                  </button>
                </>
              )}

              {/* Behind warning */}
              {activeNode.behind > 0 && (
                <div className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
                  {activeNode.behind} commit
                  {activeNode.behind !== 1 ? "s" : ""} behind {baseBranch}
                </div>
              )}

              {/* Create worktree (only for non-worktree branches) */}
              {!activeNode.isWorktree &&
                (!showNewWorktree ? (
                  <button
                    type="button"
                    onClick={() => setShowNewWorktree(true)}
                    className="w-full rounded-lg bg-emerald-500/15 px-3 py-2 text-left text-xs font-medium text-emerald-400 transition-colors hover:bg-emerald-500/25"
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

              {/* Delete */}
              <hr className="border-white/5" />
              {!confirmDelete ? (
                <button
                  type="button"
                  onClick={() => confirmIfAgentActive("Delete", () => setConfirmDelete(true))}
                  disabled={!activeNode.isWorktree && activeNode.isCurrent}
                  className="w-full rounded-lg bg-red-500/10 px-3 py-2 text-left text-xs text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-30"
                >
                  Delete {activeNode.isWorktree ? "Worktree" : "Branch"}
                </button>
              ) : (
                <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-2">
                  <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                    <input
                      type="checkbox"
                      checked={forceDelete}
                      onChange={(e) => setForceDelete(e.target.checked)}
                      className="accent-red-500"
                    />
                    Force delete{!activeNode.isWorktree ? " (unmerged)" : ""}
                  </label>
                  {!activeNode.isWorktree && activeNode.remote && (
                    <label className="mt-1 flex items-center gap-1.5 text-[11px] text-zinc-400">
                      <input
                        type="checkbox"
                        checked={deleteRemote}
                        onChange={(e) => setDeleteRemote(e.target.checked)}
                        className="accent-red-500"
                      />
                      Also delete remote branch
                    </label>
                  )}
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={activeNode.isWorktree ? handleDeleteWorktree : handleDeleteBranch}
                      disabled={actionBusy}
                      className="rounded bg-red-500/20 px-2 py-1 text-xs text-red-400 hover:bg-red-500/30 disabled:opacity-50"
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
                      className="text-xs text-zinc-500 hover:text-zinc-300"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Main branch actions */}
          {activeNode.isMain &&
            (!showNewWorktree ? (
              <button
                type="button"
                onClick={() => setShowNewWorktree(true)}
                className="w-full rounded-lg bg-emerald-500/15 px-3 py-2 text-left text-xs font-medium text-emerald-400 transition-colors hover:bg-emerald-500/25"
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
          <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-400">
            {actionError}
          </div>
        )}
      </div>
    </div>
  );
}
