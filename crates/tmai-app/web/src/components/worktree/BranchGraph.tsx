import { useState, useEffect, useMemo, useCallback } from "react";
import { api, type WorktreeSnapshot, type BranchListResponse, type GraphData } from "@/lib/api";
import type { BranchNode } from "./graph/types";
import { LaneGraph } from "./graph/LaneGraph";
import { computeLayout } from "./graph/layout";
import { ActionPanel } from "./ActionPanel";

interface BranchGraphProps {
  projectPath: string;
  projectName: string;
  worktrees: WorktreeSnapshot[];
  onSelectWorktree: (repoPath: string, name: string, worktreePath: string) => void;
}

// Format Unix timestamp as relative time (e.g., "2m ago", "3h ago")
function formatRelativeTime(unixSecs: number): string {
  const diff = Math.floor(Date.now() / 1000) - unixSecs;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const BRANCH_DEPTH_WARNING = 3;

// Graphical branch tree with interactive action panels
export function BranchGraph({
  projectPath,
  projectName,
  worktrees,
  onSelectWorktree,
}: BranchGraphProps) {
  const [branches, setBranches] = useState<BranchListResponse | null>(null);
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [initialSelected, setInitialSelected] = useState(false);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [collapsedLanes, setCollapsedLanes] = useState<Set<string>>(new Set());

  // Fetch branch list and graph data in parallel
  const fetchData = useCallback(async () => {
    try {
      const [branchResult, graphResult] = await Promise.all([
        api.listBranches(projectPath),
        api.gitGraph(projectPath, 100),
      ]);
      setBranches(branchResult);
      setGraphData(graphResult);
    } catch (e) {
      console.error(e);
    }
  }, [projectPath]);

  // Refresh branches (also refetches graph)
  const refreshBranches = useCallback(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setLoading(true);
    setInitialSelected(false);
    fetchData().finally(() => setLoading(false));
  }, [fetchData]);

  // Auto-select HEAD branch on first load
  useEffect(() => {
    if (branches && !initialSelected) {
      setSelectedNode(branches.current_branch ?? branches.default_branch);
      setInitialSelected(true);
    }
  }, [branches, initialSelected]);

  const normPath = projectPath.replace(/\/\.git\/?$/, "").replace(/\/+$/, "");

  // Filter worktrees for this project
  const projectWorktrees = useMemo(() => {
    return worktrees.filter((wt) => {
      const wtRepo = wt.repo_path.replace(/\/\.git\/?$/, "").replace(/\/+$/, "");
      return wtRepo === normPath;
    });
  }, [worktrees, normPath]);

  // Build node list
  const nodes = useMemo(() => {
    const defaultBranch = branches?.default_branch ?? "main";
    const currentBranch = branches?.current_branch ?? null;
    const parentMap = branches?.parents ?? {};
    const abMap = branches?.ahead_behind ?? {};
    const rtMap = branches?.remote_tracking ?? {};
    const mainWt = projectWorktrees.find((wt) => wt.is_main);
    const result: BranchNode[] = [];

    result.push({
      name: defaultBranch,
      parent: null,
      isWorktree: false,
      isMain: true,
      isCurrent: currentBranch === defaultBranch,
      isDirty: mainWt?.is_dirty ?? false,
      hasAgent: !!mainWt?.agent_target,
      agentStatus: mainWt?.agent_status ?? null,
      diffSummary: null,
      worktree: mainWt ?? null,
      ahead: 0,
      behind: 0,
      remote: rtMap[defaultBranch] ?? null,
    });

    for (const wt of projectWorktrees) {
      if (wt.is_main) continue;
      const branchName = wt.branch || wt.name;
      const ab = abMap[branchName];
      result.push({
        name: branchName,
        parent: parentMap[branchName] ?? defaultBranch,
        isWorktree: true,
        isMain: false,
        isCurrent: currentBranch === branchName,
        isDirty: wt.is_dirty ?? false,
        hasAgent: !!wt.agent_target,
        agentStatus: wt.agent_status,
        diffSummary: wt.diff_summary,
        worktree: wt,
        ahead: ab?.[0] ?? 0,
        behind: ab?.[1] ?? 0,
        remote: rtMap[branchName] ?? null,
      });
    }

    const listed = new Set(result.map((n) => n.name));
    if (branches) {
      for (const b of branches.branches) {
        if (!listed.has(b)) {
          const ab = abMap[b];
          result.push({
            name: b,
            parent: parentMap[b] ?? defaultBranch,
            isWorktree: false,
            isMain: false,
            isCurrent: currentBranch === b,
            isDirty: false,
            hasAgent: false,
            agentStatus: null,
            diffSummary: null,
            worktree: null,
            ahead: ab?.[0] ?? 0,
            behind: ab?.[1] ?? 0,
            remote: rtMap[b] ?? null,
          });
        }
      }
    }

    return result;
  }, [projectWorktrees, branches]);

  const branchCount = nodes.filter(n => !n.isMain).length;

  // Compute indentation depth for branch depth warning
  const nodeDepth = useMemo(() => {
    const depth = new Map<string, number>();
    const mainNode = nodes[0];
    if (!mainNode) return depth;
    depth.set(mainNode.name, 0);
    let changed = true;
    while (changed) {
      changed = false;
      for (const n of nodes) {
        if (depth.has(n.name)) continue;
        const parentDepth = n.parent ? depth.get(n.parent) : 0;
        if (parentDepth !== undefined) {
          depth.set(n.name, parentDepth + 1);
          changed = true;
        }
      }
    }
    for (const n of nodes) {
      if (!depth.has(n.name)) depth.set(n.name, 1);
    }
    return depth;
  }, [nodes]);

  // Compute lane layout from graph data
  const layout = useMemo(() => {
    if (!graphData || !branches) return null;
    return computeLayout(graphData, branches, nodes, collapsedLanes);
  }, [graphData, branches, nodes, collapsedLanes]);

  // Selected node data
  const activeNode = nodes.find((n) => n.name === selectedNode) ?? null;

  // Select a branch
  const selectBranch = useCallback((name: string) => {
    setSelectedNode(name);
  }, []);

  // Toggle lane collapse
  const toggleCollapse = useCallback((branch: string) => {
    setCollapsedLanes(prev => {
      const next = new Set(prev);
      if (next.has(branch)) {
        next.delete(branch);
      } else {
        next.add(branch);
      }
      return next;
    });
  }, []);

  // Refresh: fetch from remote + reload data
  const handleRefresh = useCallback(async () => {
    if (refreshBusy) return;
    setRefreshBusy(true);
    setRefreshError(null);
    try {
      await api.gitFetch(projectPath);
      await fetchData();
    } catch (e) {
      setRefreshError(e instanceof Error ? e.message : "Fetch failed");
    } finally {
      setRefreshBusy(false);
    }
  }, [refreshBusy, projectPath, fetchData]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
        Loading branches...
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="glass shrink-0 border-b border-white/5 px-6 py-4">
        <div className="flex items-center gap-3">
          <svg width="20" height="20" viewBox="0 0 16 16" fill="none" className="text-emerald-400">
            <circle cx="4" cy="4" r="2" fill="currentColor" />
            <circle cx="4" cy="12" r="2" fill="currentColor" />
            <circle cx="12" cy="8" r="2" fill="currentColor" />
            <line x1="4" y1="6" x2="4" y2="10" stroke="currentColor" strokeWidth="1.5" />
            <path d="M4 6 C4 8, 8 8, 12 8" stroke="currentColor" strokeWidth="1.5" fill="none" />
          </svg>
          <h2 className="text-lg font-semibold text-zinc-100">{projectName}</h2>
          <span className="text-xs text-zinc-500">
            {branchCount} branch{branchCount !== 1 ? "es" : ""}
            {" \u00B7 "}
            {projectWorktrees.filter((w) => !w.is_main).length} worktree{projectWorktrees.filter((w) => !w.is_main).length !== 1 ? "s" : ""}
          </span>
          <div className="flex-1" />
          {branches?.last_fetch && (
            <span className="text-[10px] text-zinc-600" title={new Date(branches.last_fetch * 1000).toLocaleString()}>
              fetched {formatRelativeTime(branches.last_fetch)}
            </span>
          )}
          <button
            onClick={handleRefresh}
            disabled={refreshBusy}
            className="rounded-lg bg-white/5 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-200 disabled:opacity-50"
          >
            {refreshBusy ? "..." : "Refresh"}
          </button>
        </div>
        {refreshError && (
          <div className="mt-2 text-xs text-red-400">{refreshError}</div>
        )}
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Graph canvas */}
        <div className="flex-1 overflow-auto p-6">
          {layout && layout.lanes.length > 0 ? (
            <LaneGraph
              layout={layout}
              selectedBranch={selectedNode}
              repoPath={projectPath}
              defaultBranch={branches?.default_branch ?? "main"}
              collapsedLanes={collapsedLanes}
              onSelectBranch={selectBranch}
              onToggleCollapse={toggleCollapse}
            />
          ) : (
            <div className="flex items-center justify-center py-20 text-sm text-zinc-500">
              {graphData?.commits.length === 0
                ? "No commits found"
                : "Only the default branch exists"}
            </div>
          )}

          {/* Inactive branches (not shown in graph) */}
          {nodes.filter(n => !n.isMain && !n.isWorktree && !n.hasAgent && !n.isDirty && n.ahead === 0 && !n.isCurrent).length > 0 && (
            <div className="mt-6 border-t border-white/5 pt-4">
              <div className="mb-2 text-[11px] text-zinc-600">Inactive branches</div>
              <div className="flex flex-wrap gap-1.5">
                {nodes
                  .filter(n => !n.isMain && !n.isWorktree && !n.hasAgent && !n.isDirty && n.ahead === 0 && !n.isCurrent)
                  .map(n => (
                    <button
                      key={n.name}
                      onClick={() => selectBranch(n.name)}
                      className={`rounded-md px-2 py-1 text-[11px] transition-colors ${
                        selectedNode === n.name
                          ? "bg-cyan-500/15 text-cyan-400"
                          : "bg-white/5 text-zinc-500 hover:bg-white/10 hover:text-zinc-300"
                      }`}
                    >
                      {n.name}
                      {n.behind > 0 && (
                        <span className="ml-1 text-[10px] text-red-400">{n.behind}\u2193</span>
                      )}
                    </button>
                  ))}
              </div>
            </div>
          )}
        </div>

        {/* Action panel (right side) */}
        {activeNode && (
          <ActionPanel
            activeNode={activeNode}
            branches={branches}
            projectPath={projectPath}
            nodeDepth={nodeDepth}
            branchDepthWarning={BRANCH_DEPTH_WARNING}
            onSelectWorktree={onSelectWorktree}
            onRefresh={refreshBranches}
            onSelectNode={setSelectedNode}
          />
        )}
      </div>
    </div>
  );
}
