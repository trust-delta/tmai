import { useState, useCallback } from "react";
import { api, type WorktreeDiffResponse, type BranchListResponse } from "@/lib/api";
import type { BranchNode } from "./graph/types";
import { DiffViewer } from "./DiffViewer";

interface ActionPanelProps {
  activeNode: BranchNode;
  branches: BranchListResponse | null;
  projectPath: string;
  nodeDepth: Map<string, number>;
  branchDepthWarning: number;
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
      await api.spawnPty({ command: "claude", args: ["-p", prompt], cwd: projectPath });
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
                    onClick={() => delegateToAi(`${activeNode.name} \u30D6\u30E9\u30F3\u30C1\u3092 main \u306B\u30DE\u30FC\u30B8\u3057\u3066\u304F\u3060\u3055\u3044\u3002\u30B3\u30F3\u30D5\u30EA\u30AF\u30C8\u304C\u3042\u308C\u3070\u89E3\u6D88\u3057\u3066\u304F\u3060\u3055\u3044\u3002`)}
                    disabled={actionBusy}
                    className="w-full rounded-lg bg-purple-500/15 px-3 py-2 text-left text-xs font-medium text-purple-400 transition-colors hover:bg-purple-500/25 disabled:opacity-50"
                  >
                    AI\u306B\u30DE\u30FC\u30B8\u3092\u6307\u793A
                  </button>
                  <button
                    onClick={() => delegateToAi(`${activeNode.name} \u30D6\u30E9\u30F3\u30C1\u306EPull Request\u3092\u4F5C\u6210\u3057\u3066\u304F\u3060\u3055\u3044\u3002\u5909\u66F4\u5185\u5BB9\u3092\u8981\u7D04\u3057\u3066description\u306B\u8A18\u8F09\u3057\u3066\u304F\u3060\u3055\u3044\u3002`)}
                    disabled={actionBusy}
                    className="w-full rounded-lg bg-blue-500/15 px-3 py-2 text-left text-xs font-medium text-blue-400 transition-colors hover:bg-blue-500/25 disabled:opacity-50"
                  >
                    AI\u306BPR\u4F5C\u6210\u3092\u6307\u793A
                  </button>
                </>
              )}
              {activeNode.behind > 0 && (
                <div className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
                  main\u304B\u3089{activeNode.behind}\u30B3\u30DF\u30C3\u30C8\u9045\u308C\u3066\u3044\u307E\u3059
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
                      main\u304B\u3089{(nodeDepth.get(activeNode.name) ?? 0) + 1}\u6BB5\u76EE\u306B\u306A\u308A\u307E\u3059\u3002\u89AA\u30D6\u30E9\u30F3\u30C1\u3092\u5148\u306Bmain\u306B\u30DE\u30FC\u30B8\u3059\u308B\u3053\u3068\u3092\u691C\u8A0E\u3057\u3066\u304F\u3060\u3055\u3044\u3002
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
