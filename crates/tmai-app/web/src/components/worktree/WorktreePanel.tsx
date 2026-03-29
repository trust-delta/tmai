import { useCallback, useEffect, useState } from "react";
import { api, type WorktreeDiffResponse, type WorktreeSnapshot } from "@/lib/api";
import { DiffViewer } from "./DiffViewer";

interface WorktreePanelProps {
  worktree: WorktreeSnapshot;
  onLaunched: (target: string) => void;
  onDeleted: () => void;
}

// Main area panel for a selected worktree: info, actions, diff
export function WorktreePanel({ worktree, onLaunched, onDeleted }: WorktreePanelProps) {
  const [diffData, setDiffData] = useState<WorktreeDiffResponse | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [forceDelete, setForceDelete] = useState(false);

  // Fetch diff on mount
  const fetchDiff = useCallback(async () => {
    setDiffLoading(true);
    setDiffError(null);
    try {
      const data = await api.getWorktreeDiff(worktree.path);
      setDiffData(data);
    } catch (e) {
      setDiffError(e instanceof Error ? e.message : "Failed to load diff");
    } finally {
      setDiffLoading(false);
    }
  }, [worktree.path]);

  useEffect(() => {
    fetchDiff();
  }, [fetchDiff]);

  // Launch agent in this worktree
  const handleLaunch = async () => {
    if (launching) return;
    setLaunching(true);
    try {
      const res = await api.launchWorktreeAgent(worktree.repo_path, worktree.name);
      onLaunched(res.target);
    } catch (_e) {
    } finally {
      setLaunching(false);
    }
  };

  // Delete this worktree
  const handleDelete = async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      await api.deleteWorktree(worktree.repo_path, worktree.name, forceDelete);
      onDeleted();
    } catch (_e) {
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
      setForceDelete(false);
    }
  };

  const ds = worktree.diff_summary;
  const hasAgent = !!worktree.agent_target;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="glass shrink-0 border-b border-white/5 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-emerald-500">🌿</span>
              <h2 className="text-lg font-semibold text-zinc-100">
                {worktree.branch || worktree.name}
              </h2>
              {worktree.is_dirty && <span className="text-sm text-amber-500">*</span>}
            </div>
            <div className="mt-1 flex items-center gap-3 text-xs text-zinc-500">
              {ds && (
                <span>
                  <span className="text-emerald-400">+{ds.insertions}</span>{" "}
                  <span className="text-red-400">-{ds.deletions}</span>
                  {" · "}
                  {ds.files_changed} file{ds.files_changed !== 1 ? "s" : ""}
                </span>
              )}
              {hasAgent ? (
                <span className="text-cyan-400">Agent: {worktree.agent_status || "active"}</span>
              ) : (
                <span className="text-zinc-600">No agent</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <span className="font-mono">{worktree.repo_name}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="mt-3 flex items-center gap-2">
          {!hasAgent && (
            <button
              type="button"
              onClick={handleLaunch}
              disabled={launching}
              className="rounded-lg bg-cyan-500/15 px-3 py-1.5 text-xs font-medium text-cyan-400 transition-colors hover:bg-cyan-500/25 disabled:opacity-50"
            >
              {launching ? "Launching..." : "Launch Agent"}
            </button>
          )}
          {!confirmDelete ? (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="rounded-lg bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/20"
            >
              Delete
            </button>
          ) : (
            <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-1.5">
              <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                <input
                  type="checkbox"
                  checked={forceDelete}
                  onChange={(e) => setForceDelete(e.target.checked)}
                  className="accent-red-500"
                />
                Force
              </label>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="rounded bg-red-500/20 px-2 py-0.5 text-xs text-red-400 transition-colors hover:bg-red-500/30 disabled:opacity-50"
              >
                {deleting ? "Deleting..." : "Confirm"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmDelete(false);
                  setForceDelete(false);
                }}
                className="text-xs text-zinc-500 transition-colors hover:text-zinc-300"
              >
                Cancel
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={fetchDiff}
            disabled={diffLoading}
            className="rounded-lg bg-white/5 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:bg-white/10 disabled:opacity-50"
          >
            {diffLoading ? "Loading..." : "Refresh Diff"}
          </button>
        </div>
      </div>

      {/* Diff content */}
      <div className="flex-1 overflow-y-auto p-4">
        {diffError ? (
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400">
            {diffError}
          </div>
        ) : diffLoading && !diffData ? (
          <div className="py-8 text-center text-sm text-zinc-500">Loading diff...</div>
        ) : diffData?.diff ? (
          <DiffViewer diff={diffData.diff} />
        ) : (
          <div className="py-8 text-center text-sm text-zinc-500">No changes vs base branch</div>
        )}
      </div>
    </div>
  );
}
