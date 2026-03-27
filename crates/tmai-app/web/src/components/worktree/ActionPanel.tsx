import { useState, useCallback, useEffect } from "react";
import { api, type WorktreeDiffResponse, type BranchListResponse, type PrInfo, type CiSummary, type IssueInfo } from "@/lib/api";
import type { BranchNode } from "./graph/types";
import { DiffViewer } from "./DiffViewer";

interface ActionPanelProps {
  activeNode: BranchNode;
  branches: BranchListResponse | null;
  projectPath: string;
  nodeDepth: Map<string, number>;
  branchDepthWarning: number;
  prInfo: PrInfo | undefined;
  issues: IssueInfo[];
  onSelectWorktree: (repoPath: string, name: string, worktreePath: string) => void;
  onRefresh: () => void;
  onSelectNode: (name: string | null) => void;
}

// Right-side action panel for selected branch
export function ActionPanel({
  activeNode,
  branches,
  projectPath,
  nodeDepth,
  branchDepthWarning,
  prInfo,
  issues,
  onSelectWorktree,
  onRefresh,
  onSelectNode,
}: ActionPanelProps) {
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [forceDelete, setForceDelete] = useState(false);
  const [diffData, setDiffData] = useState<WorktreeDiffResponse | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [showNewWorktree, setShowNewWorktree] = useState(false);
  const [newWtName, setNewWtName] = useState("");
  const [newWtError, setNewWtError] = useState("");
  const [ciSummary, setCiSummary] = useState<CiSummary | null>(null);
  const [ciLoading, setCiLoading] = useState(false);
  const [ciExpanded, setCiExpanded] = useState(false);

  // Fetch CI checks when branch changes
  useEffect(() => {
    setCiSummary(null);
    setCiExpanded(false);
    if (!activeNode.name) return;
    setCiLoading(true);
    api.listChecks(projectPath, activeNode.name)
      .then(setCiSummary)
      .catch(() => setCiSummary(null))
      .finally(() => setCiLoading(false));
  }, [activeNode.name, projectPath]);

  // Focus parent or HEAD after deletion
  const focusAfterDelete = useCallback(() => {
    const target = activeNode.parent ?? branches?.current_branch ?? branches?.default_branch ?? "main";
    onSelectNode(target);
  }, [activeNode.parent, branches, onSelectNode]);

  const handleViewDiff = useCallback(async () => {
    if (!activeNode.worktree) return;
    setDiffLoading(true);
    try {
      const data = await api.getWorktreeDiff(activeNode.worktree.path);
      setDiffData(data);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to load diff");
    } finally {
      setDiffLoading(false);
    }
  }, [activeNode.worktree]);

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
      await api.deleteWorktree(activeNode.worktree.repo_path, activeNode.worktree.name, forceDelete);
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
      await api.deleteBranch(projectPath, activeNode.name, forceDelete);
      focusAfterDelete();
      onRefresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to delete branch");
    } finally {
      setActionBusy(false);
    }
  }, [actionBusy, projectPath, activeNode.name, forceDelete, focusAfterDelete, onRefresh]);

  const handleCreateWorktree = useCallback(async (baseBranch: string) => {
    const name = newWtName.trim();
    if (!name || actionBusy) return;
    if (!/^[a-zA-Z0-9_-]+$/.test(name) || name.length > 64) {
      setNewWtError("a-z, 0-9, -, _ only (max 64)");
      return;
    }
    setActionBusy(true);
    setActionError(null);
    try {
      await api.createWorktree(projectPath, name, baseBranch);
      onRefresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to create worktree");
    } finally {
      setActionBusy(false);
    }
  }, [actionBusy, newWtName, projectPath, onRefresh]);

  // AI delegation
  const delegateToAi = useCallback(async (prompt: string) => {
    if (actionBusy) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await api.spawnPty({ command: "claude", args: [prompt], cwd: projectPath });
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to launch agent");
    } finally {
      setActionBusy(false);
    }
  }, [actionBusy, projectPath]);

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
              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-400">default</span>
            )}
            {activeNode.isWorktree && (
              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-400">worktree</span>
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
          {activeNode.diffSummary && (
            <div className="mt-2 text-xs text-zinc-500">
              <span className="text-emerald-400">+{activeNode.diffSummary.insertions}</span>
              {" "}
              <span className="text-red-400">-{activeNode.diffSummary.deletions}</span>
              {" \u00B7 "}
              {activeNode.diffSummary.files_changed} file{activeNode.diffSummary.files_changed !== 1 ? "s" : ""}
            </div>
          )}
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
            <div className="mt-2 rounded bg-white/[0.03] px-2 py-1.5 text-[11px]">
              <div className="flex items-center gap-1.5">
                <a
                  href={prInfo.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-green-400 hover:underline"
                >
                  PR #{prInfo.number}
                </a>
                {prInfo.is_draft && (
                  <span className="rounded bg-zinc-500/15 px-1 py-0.5 text-[10px] text-zinc-500">draft</span>
                )}
              </div>
              <div className="mt-0.5 truncate text-zinc-400">{prInfo.title}</div>
              {prInfo.review_decision && (
                <div className="mt-1 flex items-center gap-2">
                  <span className={`text-[10px] ${
                    prInfo.review_decision === "APPROVED" ? "text-green-400"
                    : prInfo.review_decision === "CHANGES_REQUESTED" ? "text-orange-400"
                    : "text-zinc-500"
                  }`}>
                    {prInfo.review_decision === "APPROVED" ? "Approved"
                     : prInfo.review_decision === "CHANGES_REQUESTED" ? "Changes requested"
                     : "Review required"}
                  </span>
                </div>
              )}
              {(prInfo.additions > 0 || prInfo.deletions > 0) && (
                <div className="mt-0.5 text-[10px] text-zinc-600">
                  <span className="text-emerald-400">+{prInfo.additions}</span>
                  {" "}
                  <span className="text-red-400">-{prInfo.deletions}</span>
                </div>
              )}
              {(prInfo.reviews > 0 || prInfo.comments > 0) && (
                <div className="mt-0.5 flex items-center gap-2 text-[10px] text-zinc-600">
                  {prInfo.reviews > 0 && (
                    <span>{prInfo.reviews} review{prInfo.reviews !== 1 ? "s" : ""}</span>
                  )}
                  {prInfo.comments > 0 && (
                    <span>{prInfo.comments} comment{prInfo.comments !== 1 ? "s" : ""}</span>
                  )}
                </div>
              )}
            </div>
          )}
          {/* CI checks */}
          {ciLoading && (
            <div className="mt-2 text-[11px] text-zinc-600">Loading checks...</div>
          )}
          {ciSummary && ciSummary.checks.length > 0 && (
            <div className="mt-2">
              <button
                onClick={() => setCiExpanded(v => !v)}
                className="flex items-center gap-1.5 text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                <span className={`inline-block h-2 w-2 rounded-full ${
                  ciSummary.rollup === "SUCCESS" ? "bg-green-400"
                  : ciSummary.rollup === "FAILURE" ? "bg-red-400"
                  : ciSummary.rollup === "PENDING" ? "bg-yellow-400"
                  : "bg-zinc-600"
                }`} />
                <span>
                  CI {ciSummary.rollup === "SUCCESS" ? "passed"
                    : ciSummary.rollup === "FAILURE" ? "failed"
                    : ciSummary.rollup === "PENDING" ? "running"
                    : "unknown"}
                </span>
                <span className="text-[10px] text-zinc-600">
                  ({ciSummary.checks.length} check{ciSummary.checks.length !== 1 ? "s" : ""})
                </span>
                <span className="text-[10px]">{ciExpanded ? "\u25BE" : "\u25B8"}</span>
              </button>
              {ciExpanded && (
                <div className="mt-1.5 flex flex-col gap-1">
                  {ciSummary.checks.map((check) => (
                    <a
                      key={check.name + check.url}
                      href={check.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 rounded bg-white/[0.03] px-2 py-1 text-[11px] hover:bg-white/[0.06] transition-colors"
                    >
                      <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                        check.conclusion === "success" ? "bg-green-400"
                        : check.conclusion === "failure" ? "bg-red-400"
                        : check.status === "in_progress" || check.status === "queued" ? "bg-yellow-400"
                        : "bg-zinc-600"
                      }`} />
                      <span className="truncate text-zinc-300">{check.name}</span>
                      <span className={`ml-auto shrink-0 text-[10px] ${
                        check.conclusion === "success" ? "text-green-400"
                        : check.conclusion === "failure" ? "text-red-400"
                        : check.status === "in_progress" ? "text-yellow-400"
                        : "text-zinc-600"
                      }`}>
                        {check.conclusion ?? check.status}
                      </span>
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}
          {ciSummary && ciSummary.checks.length === 0 && !ciLoading && (
            prInfo?.check_status ? (
              <div className="mt-2 flex items-center gap-1.5 text-[11px]">
                <span className={`inline-block h-2 w-2 rounded-full ${
                  prInfo.check_status === "SUCCESS" ? "bg-green-400"
                  : prInfo.check_status === "FAILURE" ? "bg-red-400"
                  : prInfo.check_status === "PENDING" ? "bg-yellow-400"
                  : "bg-zinc-600"
                }`} />
                <span className={
                  prInfo.check_status === "SUCCESS" ? "text-green-400"
                  : prInfo.check_status === "FAILURE" ? "text-red-400"
                  : prInfo.check_status === "PENDING" ? "text-yellow-400"
                  : "text-zinc-600"
                }>
                  {prInfo.check_status === "SUCCESS" ? "CI passed"
                   : prInfo.check_status === "FAILURE" ? "CI failed"
                   : prInfo.check_status === "PENDING" ? "CI running"
                   : "CI unknown"}
                </span>
                <span className="text-[10px] text-zinc-600">(from PR)</span>
              </div>
            ) : (
              <div className="mt-2 text-[11px] text-zinc-600">No CI checks</div>
            )
          )}
          {/* Linked issues */}
          {(() => {
            // Extract issue numbers from branch name and PR title
            const nums = extractIssueNumbers(activeNode.name);
            if (prInfo?.title) {
              for (const n of extractIssueRefs(prInfo.title)) {
                if (!nums.includes(n)) nums.push(n);
              }
            }
            const linked = issues.filter(i => nums.includes(i.number));
            if (linked.length === 0) return null;
            return (
              <div className="mt-2">
                <div className="text-[11px] text-zinc-500 mb-1">Linked issues</div>
                <div className="flex flex-col gap-1">
                  {linked.map(issue => (
                    <a
                      key={issue.number}
                      href={issue.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-start gap-1.5 rounded bg-white/[0.03] px-2 py-1.5 text-[11px] hover:bg-white/[0.06] transition-colors"
                    >
                      <span className="shrink-0 text-green-400">#{issue.number}</span>
                      <span className="truncate text-zinc-300">{issue.title}</span>
                      {issue.labels.length > 0 && (
                        <div className="ml-auto flex shrink-0 gap-1">
                          {issue.labels.slice(0, 2).map(label => (
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

        {/* Action buttons */}
        <div className="flex flex-col gap-2">
          {/* Worktree actions */}
          {activeNode.isWorktree && activeNode.worktree && (
            <>
              <button
                onClick={handleViewDiff}
                disabled={diffLoading}
                className="w-full rounded-lg bg-white/5 px-3 py-2 text-left text-xs text-zinc-300 transition-colors hover:bg-white/10 disabled:opacity-50"
              >
                {diffLoading ? "Loading..." : "View Diff"}
              </button>
              {!activeNode.hasAgent && (
                <button
                  onClick={handleLaunchAgent}
                  disabled={actionBusy}
                  className="w-full rounded-lg bg-cyan-500/15 px-3 py-2 text-left text-xs font-medium text-cyan-400 transition-colors hover:bg-cyan-500/25 disabled:opacity-50"
                >
                  {actionBusy ? "Launching..." : "Launch Agent"}
                </button>
              )}
              <button
                onClick={() => {
                  const wt = activeNode.worktree!;
                  onSelectWorktree(wt.repo_path, wt.name, wt.path);
                }}
                className="w-full rounded-lg bg-white/5 px-3 py-2 text-left text-xs text-zinc-300 transition-colors hover:bg-white/10"
              >
                Open Detail Panel
              </button>
              <hr className="border-white/5" />
              {!confirmDelete ? (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="w-full rounded-lg bg-red-500/10 px-3 py-2 text-left text-xs text-red-400 transition-colors hover:bg-red-500/20"
                >
                  Delete Worktree
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
                    Force delete
                  </label>
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={handleDeleteWorktree}
                      disabled={actionBusy}
                      className="rounded bg-red-500/20 px-2 py-1 text-xs text-red-400 hover:bg-red-500/30 disabled:opacity-50"
                    >
                      {actionBusy ? "..." : "Confirm"}
                    </button>
                    <button
                      onClick={() => { setConfirmDelete(false); setForceDelete(false); }}
                      className="text-xs text-zinc-500 hover:text-zinc-300"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Plain branch actions */}
          {!activeNode.isWorktree && !activeNode.isMain && (
            <>
              {/* AI delegation: merge / PR */}
              {activeNode.ahead > 0 && (
                <>
                  <button
                    onClick={() => delegateToAi(`Merge the ${activeNode.name} branch into main. Resolve any conflicts if present.`)}
                    disabled={actionBusy}
                    className="w-full rounded-lg bg-purple-500/15 px-3 py-2 text-left text-xs font-medium text-purple-400 transition-colors hover:bg-purple-500/25 disabled:opacity-50"
                  >
                    AI Merge
                  </button>
                  <button
                    onClick={() => delegateToAi(`Create a Pull Request for the ${activeNode.name} branch. Summarize the changes in the description.`)}
                    disabled={actionBusy}
                    className="w-full rounded-lg bg-blue-500/15 px-3 py-2 text-left text-xs font-medium text-blue-400 transition-colors hover:bg-blue-500/25 disabled:opacity-50"
                  >
                    AI Create PR
                  </button>
                </>
              )}
              {activeNode.behind > 0 && (
                <div className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
                  {activeNode.behind} commit{activeNode.behind !== 1 ? "s" : ""} behind main
                </div>
              )}
              {/* Create worktree from this branch */}
              {!showNewWorktree ? (
                <button
                  onClick={() => setShowNewWorktree(true)}
                  className="w-full rounded-lg bg-emerald-500/15 px-3 py-2 text-left text-xs font-medium text-emerald-400 transition-colors hover:bg-emerald-500/25"
                >
                  Create Worktree
                </button>
              ) : (
                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2">
                  <div className="mb-1 text-[11px] text-zinc-500">
                    from: <span className="text-emerald-400">{activeNode.name}</span>
                  </div>
                  {(nodeDepth.get(activeNode.name) ?? 0) + 1 >= branchDepthWarning && (
                    <div className="mb-2 rounded bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-400">
                      This will be {(nodeDepth.get(activeNode.name) ?? 0) + 1} levels deep from main. Consider merging the parent branch first.
                    </div>
                  )}
                  <div className="flex items-center gap-1">
                    <input
                      autoFocus
                      type="text"
                      value={newWtName}
                      onChange={(e) => {
                        setNewWtName(e.target.value);
                        setNewWtError("");
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleCreateWorktree(activeNode.name);
                        if (e.key === "Escape") { setShowNewWorktree(false); setNewWtName(""); }
                      }}
                      placeholder="worktree name"
                      className="flex-1 rounded bg-black/30 px-2 py-1 text-xs text-zinc-200 placeholder-zinc-600 outline-none ring-1 ring-emerald-500/30 focus:ring-emerald-500/60"
                    />
                    <button
                      onClick={() => handleCreateWorktree(activeNode.name)}
                      disabled={!newWtName.trim() || actionBusy}
                      className="rounded px-2 py-1 text-xs text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-30"
                    >
                      Go
                    </button>
                  </div>
                  {newWtError && <span className="text-[10px] text-red-400">{newWtError}</span>}
                </div>
              )}
              <hr className="border-white/5" />
              {!confirmDelete ? (
                <button
                  onClick={() => setConfirmDelete(true)}
                  disabled={activeNode.isCurrent}
                  className="w-full rounded-lg bg-red-500/10 px-3 py-2 text-left text-xs text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-30"
                >
                  Delete Branch
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
                    Force delete (unmerged)
                  </label>
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={handleDeleteBranch}
                      disabled={actionBusy}
                      className="rounded bg-red-500/20 px-2 py-1 text-xs text-red-400 hover:bg-red-500/30 disabled:opacity-50"
                    >
                      {actionBusy ? "..." : "Confirm"}
                    </button>
                    <button
                      onClick={() => { setConfirmDelete(false); setForceDelete(false); }}
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
          {activeNode.isMain && (
            <>
              {!showNewWorktree ? (
                <button
                  onClick={() => setShowNewWorktree(true)}
                  className="w-full rounded-lg bg-emerald-500/15 px-3 py-2 text-left text-xs font-medium text-emerald-400 transition-colors hover:bg-emerald-500/25"
                >
                  Create Worktree
                </button>
              ) : (
                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2">
                  <div className="mb-1 text-[11px] text-zinc-500">
                    from: <span className="text-emerald-400">{activeNode.name}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <input
                      autoFocus
                      type="text"
                      value={newWtName}
                      onChange={(e) => {
                        setNewWtName(e.target.value);
                        setNewWtError("");
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleCreateWorktree(activeNode.name);
                        if (e.key === "Escape") { setShowNewWorktree(false); setNewWtName(""); }
                      }}
                      placeholder="worktree name"
                      className="flex-1 rounded bg-black/30 px-2 py-1 text-xs text-zinc-200 placeholder-zinc-600 outline-none ring-1 ring-emerald-500/30 focus:ring-emerald-500/60"
                    />
                    <button
                      onClick={() => handleCreateWorktree(activeNode.name)}
                      disabled={!newWtName.trim() || actionBusy}
                      className="rounded px-2 py-1 text-xs text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-30"
                    >
                      Go
                    </button>
                  </div>
                  {newWtError && <span className="text-[10px] text-red-400">{newWtError}</span>}
                </div>
              )}
            </>
          )}
        </div>

        {/* Error display */}
        {actionError && (
          <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-400">
            {actionError}
          </div>
        )}

        {/* Inline diff viewer */}
        {diffData?.diff && (
          <div className="mt-4">
            <DiffViewer diff={diffData.diff} />
          </div>
        )}
        {diffData && !diffData.diff && !diffLoading && (
          <div className="mt-4 text-center text-xs text-zinc-500">
            No changes vs base branch
          </div>
        )}
      </div>
    </div>
  );
}

/// Extract issue numbers from a branch name (e.g., "fix/123-desc" → [123])
function extractIssueNumbers(branch: string): number[] {
  const nums: number[] = [];
  for (const part of branch.split(/[/\-_]/)) {
    const n = parseInt(part, 10);
    if (!isNaN(n) && n > 0 && n < 100000) {
      nums.push(n);
    }
  }
  return nums;
}

/// Extract issue references from text (e.g., "Fixes #42", "closes #7", "resolves #123")
function extractIssueRefs(text: string): number[] {
  const nums: number[] = [];
  const pattern = /(?:fix(?:es)?|close[sd]?|resolve[sd]?)\s*#(\d+)/gi;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const n = parseInt(match[1], 10);
    if (n > 0 && n < 100000) nums.push(n);
  }
  // Also match standalone #N references
  const hashPattern = /#(\d+)/g;
  while ((match = hashPattern.exec(text)) !== null) {
    const n = parseInt(match[1], 10);
    if (n > 0 && n < 100000 && !nums.includes(n)) nums.push(n);
  }
  return nums;
}
