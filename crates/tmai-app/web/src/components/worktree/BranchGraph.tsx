import { useState, useEffect, useMemo, useCallback } from "react";
import { api, type WorktreeSnapshot, type BranchListResponse, type WorktreeDiffResponse } from "@/lib/api";
import { DiffViewer } from "./DiffViewer";

interface BranchGraphProps {
  projectPath: string;
  projectName: string;
  worktrees: WorktreeSnapshot[];
  onSelectWorktree: (repoPath: string, name: string, worktreePath: string) => void;
}

// SVG layout constants
const NODE_R = 8;
const ROW_H = 56;
const TRUNK_X = 80;
const TOP_PAD = 40;

interface BranchNode {
  name: string;
  parent: string | null; // parent branch name (null for main)
  isWorktree: boolean;
  isMain: boolean;
  isCurrent: boolean;
  isDirty: boolean;
  hasAgent: boolean;
  agentStatus: string | null;
  diffSummary: { files_changed: number; insertions: number; deletions: number } | null;
  worktree: WorktreeSnapshot | null;
}

// Graphical branch tree with interactive action panels
export function BranchGraph({
  projectPath,
  projectName,
  worktrees,
  onSelectWorktree,
}: BranchGraphProps) {
  const [branches, setBranches] = useState<BranchListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [initialSelected, setInitialSelected] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [forceDelete, setForceDelete] = useState(false);
  const [diffData, setDiffData] = useState<WorktreeDiffResponse | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [showNewWorktree, setShowNewWorktree] = useState(false);
  const [newWtName, setNewWtName] = useState("");
  const [newWtError, setNewWtError] = useState("");

  // Fetch branch list
  const refreshBranches = useCallback(() => {
    api.listBranches(projectPath).then(setBranches).catch(console.error);
  }, [projectPath]);

  useEffect(() => {
    setLoading(true);
    setInitialSelected(false);
    api.listBranches(projectPath)
      .then(setBranches)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [projectPath]);

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
    });

    for (const wt of projectWorktrees) {
      if (wt.is_main) continue;
      const branchName = wt.branch || wt.name;
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
      });
    }

    const listed = new Set(result.map((n) => n.name));
    if (branches) {
      for (const b of branches.branches) {
        if (!listed.has(b)) {
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
          });
        }
      }
    }

    // Sort: children appear right after their parent (depth-first tree order)
    const mainItem = result[0];
    const rest = result.slice(1);
    const sorted: BranchNode[] = [mainItem];
    const childrenOf = new Map<string, BranchNode[]>();
    for (const n of rest) {
      const p = n.parent ?? defaultBranch;
      const list = childrenOf.get(p) ?? [];
      list.push(n);
      childrenOf.set(p, list);
    }
    const visit = (parentName: string) => {
      const children = childrenOf.get(parentName);
      if (!children) return;
      for (const child of children) {
        sorted.push(child);
        visit(child.name);
      }
    };
    visit(defaultBranch);
    // Add any orphans not reachable from default
    for (const n of rest) {
      if (!sorted.includes(n)) sorted.push(n);
    }

    return sorted;
  }, [projectWorktrees, branches]);

  const mainNode = nodes[0];
  const branchNodes = nodes.slice(1);
  const svgHeight = TOP_PAD + Math.max(branchNodes.length, 1) * ROW_H + 40;

  // Compute indentation level based on ancestry depth
  const nodeDepth = useMemo(() => {
    const depth = new Map<string, number>();
    depth.set(mainNode.name, 0);
    let changed = true;
    while (changed) {
      changed = false;
      for (const n of branchNodes) {
        if (depth.has(n.name)) continue;
        const parentDepth = n.parent ? depth.get(n.parent) : 0;
        if (parentDepth !== undefined) {
          depth.set(n.name, parentDepth + 1);
          changed = true;
        }
      }
    }
    for (const n of branchNodes) {
      if (!depth.has(n.name)) depth.set(n.name, 1);
    }
    return depth;
  }, [mainNode, branchNodes]);

  const maxDepth = Math.max(...[...nodeDepth.values()], 1);
  const svgWidth = Math.max(600, TRUNK_X + maxDepth * 50 + 300);

  // Build Y-position map for parent-aware drawing
  const nodeYMap = useMemo(() => {
    const map = new Map<string, number>();
    map.set(mainNode.name, TOP_PAD);
    branchNodes.forEach((n, i) => map.set(n.name, TOP_PAD + (i + 1) * ROW_H));
    return map;
  }, [mainNode, branchNodes]);

  // Selected node data
  const activeNode = nodes.find((n) => n.name === selectedNode) ?? null;

  // Select a node (always show panel, no toggle-off)
  const selectNode = useCallback((name: string | null) => {
    if (name === null) return;
    setSelectedNode(name);
    setActionError(null);
    setConfirmDelete(false);
    setForceDelete(false);
    setDiffData(null);
    setDiffLoading(false);
    setShowNewWorktree(false);
    setNewWtName("");
    setNewWtError("");
  }, []);

  // Actions
  const handleViewDiff = useCallback(async (node: BranchNode) => {
    if (!node.worktree) return;
    setDiffLoading(true);
    try {
      const data = await api.getWorktreeDiff(node.worktree.path);
      setDiffData(data);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to load diff");
    } finally {
      setDiffLoading(false);
    }
  }, []);

  const handleLaunchAgent = useCallback(async (node: BranchNode) => {
    if (!node.worktree || actionBusy) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await api.launchWorktreeAgent(node.worktree.repo_path, node.worktree.name);
      selectNode(null);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to launch agent");
    } finally {
      setActionBusy(false);
    }
  }, [actionBusy, selectNode]);

  // After deletion, focus on parent or HEAD
  const focusAfterDelete = useCallback((node: BranchNode) => {
    const target = node.parent ?? branches?.current_branch ?? branches?.default_branch ?? mainNode.name;
    setSelectedNode(target);
    setActionError(null);
    setConfirmDelete(false);
    setForceDelete(false);
    setDiffData(null);
    setDiffLoading(false);
    setShowNewWorktree(false);
    setShowNewBranch(false);
    setGitOutput(null);
  }, [branches, mainNode.name]);

  const handleDeleteWorktree = useCallback(async (node: BranchNode) => {
    if (!node.worktree || actionBusy) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await api.deleteWorktree(node.worktree.repo_path, node.worktree.name, forceDelete);
      focusAfterDelete(node);
      refreshBranches();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to delete worktree");
    } finally {
      setActionBusy(false);
    }
  }, [actionBusy, forceDelete, selectNode, refreshBranches]);

  const handleDeleteBranch = useCallback(async (node: BranchNode) => {
    if (actionBusy) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await api.deleteBranch(projectPath, node.name, forceDelete);
      focusAfterDelete(node);
      refreshBranches();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to delete branch");
    } finally {
      setActionBusy(false);
    }
  }, [actionBusy, projectPath, forceDelete, selectNode, refreshBranches]);

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
      selectNode(null);
      refreshBranches();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to create worktree");
    } finally {
      setActionBusy(false);
    }
  }, [actionBusy, newWtName, projectPath, selectNode, refreshBranches]);

  // Git operations
  const [gitOutput, setGitOutput] = useState<string | null>(null);

  const handleCheckout = useCallback(async (branch: string) => {
    if (actionBusy) return;
    setActionBusy(true);
    setActionError(null);
    setGitOutput(null);
    try {
      await api.checkoutBranch(projectPath, branch);
      setGitOutput(`Switched to branch '${branch}'`);
      refreshBranches();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Checkout failed");
    } finally {
      setActionBusy(false);
    }
  }, [actionBusy, projectPath, refreshBranches]);

  const handleFetch = useCallback(async () => {
    if (actionBusy) return;
    setActionBusy(true);
    setActionError(null);
    setGitOutput(null);
    try {
      const res = await api.gitFetch(projectPath);
      setGitOutput(res.output || "Fetched (up to date)");
      refreshBranches();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Fetch failed");
    } finally {
      setActionBusy(false);
    }
  }, [actionBusy, projectPath, refreshBranches]);

  const handlePull = useCallback(async () => {
    if (actionBusy) return;
    setActionBusy(true);
    setActionError(null);
    setGitOutput(null);
    try {
      const res = await api.gitPull(projectPath);
      setGitOutput(res.output || "Already up to date");
      refreshBranches();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Pull failed");
    } finally {
      setActionBusy(false);
    }
  }, [actionBusy, projectPath, refreshBranches]);

  const handleMerge = useCallback(async (branch: string) => {
    if (actionBusy) return;
    setActionBusy(true);
    setActionError(null);
    setGitOutput(null);
    try {
      const res = await api.gitMerge(projectPath, branch);
      setGitOutput(res.output || "Merge complete");
      refreshBranches();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Merge failed");
    } finally {
      setActionBusy(false);
    }
  }, [actionBusy, projectPath, refreshBranches]);

  const [showNewBranch, setShowNewBranch] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");

  const handleCreateBranch = useCallback(async (base: string) => {
    const name = newBranchName.trim();
    if (!name || actionBusy) return;
    if (!/^[a-zA-Z0-9/_.-]+$/.test(name)) {
      setActionError("Invalid branch name");
      return;
    }
    setActionBusy(true);
    setActionError(null);
    setGitOutput(null);
    try {
      await api.createBranch(projectPath, name, base);
      setGitOutput(`Branch '${name}' created from '${base}'`);
      setShowNewBranch(false);
      setNewBranchName("");
      refreshBranches();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to create branch");
    } finally {
      setActionBusy(false);
    }
  }, [actionBusy, newBranchName, projectPath, refreshBranches]);

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
            {branchNodes.length} branch{branchNodes.length !== 1 ? "es" : ""}
            {" · "}
            {projectWorktrees.filter((w) => !w.is_main).length} worktree{projectWorktrees.filter((w) => !w.is_main).length !== 1 ? "s" : ""}
          </span>
          <div className="flex-1" />
          <button
            onClick={handleFetch}
            disabled={actionBusy}
            className="rounded-lg bg-white/5 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-200 disabled:opacity-50"
          >
            {actionBusy ? "..." : "Fetch"}
          </button>
          <button
            onClick={handlePull}
            disabled={actionBusy}
            className="rounded-lg bg-white/5 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-200 disabled:opacity-50"
          >
            {actionBusy ? "..." : "Pull"}
          </button>
        </div>
        {/* Git output toast */}
        {gitOutput && (
          <div className="mt-2 flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-400">
            <span className="flex-1 font-mono">{gitOutput}</span>
            <button onClick={() => setGitOutput(null)} className="text-zinc-500 hover:text-zinc-300">x</button>
          </div>
        )}
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Graph canvas */}
        <div className="flex-1 overflow-auto p-6">
          <svg
            width={svgWidth}
            height={svgHeight}
            className="mx-auto"
            style={{ minWidth: svgWidth }}
          >
            <defs>
              <filter id="glow-emerald">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <filter id="glow-cyan">
                <feGaussianBlur stdDeviation="2" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <filter id="glow-selected">
                <feGaussianBlur stdDeviation="4" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* Trunk line (extends to the last direct child of main) */}
            {(() => {
              const lastDirectIdx = branchNodes.reduce((acc, n, i) =>
                (n.parent === mainNode.name || n.parent === null) ? i : acc, -1);
              const trunkEndY = lastDirectIdx >= 0
                ? TOP_PAD + (lastDirectIdx + 1) * ROW_H
                : TOP_PAD + 20;
              return (
                <line
                  x1={TRUNK_X} y1={TOP_PAD} x2={TRUNK_X} y2={trunkEndY}
                  stroke="rgba(161,161,170,0.3)" strokeWidth="2"
                />
              );
            })()}

            {/* Main node */}
            <g className="cursor-pointer" onClick={() => selectNode(mainNode.name)}>
              <circle
                cx={TRUNK_X}
                cy={TOP_PAD}
                r={NODE_R + 2}
                fill={selectedNode === mainNode.name ? "rgba(34,211,238,0.2)" : "rgba(16,185,129,0.15)"}
                stroke={selectedNode === mainNode.name ? "rgb(34,211,238)" : "rgb(16,185,129)"}
                strokeWidth="2"
                filter={selectedNode === mainNode.name ? "url(#glow-selected)" : "url(#glow-emerald)"}
              />
              <text
                x={TRUNK_X + 18}
                y={TOP_PAD + 1}
                fill="rgb(16,185,129)"
                fontSize="13"
                fontWeight="600"
                dominantBaseline="middle"
              >
                {mainNode.name}
              </text>
              {mainNode.isCurrent && (
                <text
                  x={TRUNK_X + 18 + mainNode.name.length * 8 + 8}
                  y={TOP_PAD + 1}
                  fill="rgb(34,211,238)"
                  fontSize="10"
                  dominantBaseline="middle"
                >
                  HEAD
                </text>
              )}
              {mainNode.hasAgent && (
                <circle
                  cx={TRUNK_X + 18 + mainNode.name.length * 8 + (mainNode.isCurrent ? 40 : 8)}
                  cy={TOP_PAD}
                  r={4}
                  fill="rgb(34,211,238)"
                  filter="url(#glow-cyan)"
                />
              )}
            </g>

            {/* Branch nodes */}
            {branchNodes.map((node, i) => {
              const y = TOP_PAD + (i + 1) * ROW_H;
              const isSelected = selectedNode === node.name;
              const depth = nodeDepth.get(node.name) ?? 1;
              const nodeX = TRUNK_X + depth * 50;

              // Find parent's position for fork curve
              const parentY = node.parent ? (nodeYMap.get(node.parent) ?? TOP_PAD) : TOP_PAD;
              const parentDepth = node.parent ? (nodeDepth.get(node.parent) ?? 0) : 0;
              const parentX = TRUNK_X + parentDepth * 50;
              // Fork point: between parent and this node
              const forkFromY = parentY + Math.min((y - parentY) * 0.3, ROW_H * 0.5);

              return (
                <g
                  key={node.name}
                  className="cursor-pointer"
                  onClick={() => selectNode(node.name)}
                >
                  {/* Vertical line from parent to fork point */}
                  {parentX === TRUNK_X && parentY < forkFromY && (
                    <line
                      x1={parentX} y1={parentY} x2={parentX} y2={forkFromY}
                      stroke="rgba(161,161,170,0.15)" strokeWidth="1"
                    />
                  )}

                  {/* Fork curve from parent to this node */}
                  <path
                    d={`M${parentX},${forkFromY} C${parentX + 25},${(forkFromY + y) / 2} ${nodeX - 25},${y} ${nodeX},${y}`}
                    stroke={
                      isSelected
                        ? "rgba(34,211,238,0.5)"
                        : node.isWorktree
                          ? "rgba(16,185,129,0.4)"
                          : "rgba(161,161,170,0.15)"
                    }
                    strokeWidth={isSelected ? "2" : "1.5"}
                    fill="none"
                  />

                  {/* Fork point dot on parent */}
                  <circle
                    cx={parentX}
                    cy={forkFromY}
                    r={3}
                    fill={
                      isSelected
                        ? "rgb(34,211,238)"
                        : node.isWorktree
                          ? "rgb(16,185,129)"
                          : "rgba(161,161,170,0.4)"
                    }
                  />

                  {/* Branch node circle */}
                  <circle
                    cx={nodeX}
                    cy={y}
                    r={NODE_R}
                    fill={
                      isSelected
                        ? "rgba(34,211,238,0.2)"
                        : node.isCurrent
                          ? "rgba(34,211,238,0.15)"
                          : node.isWorktree
                            ? "rgba(16,185,129,0.15)"
                            : "rgba(161,161,170,0.08)"
                    }
                    stroke={
                      isSelected
                        ? "rgb(34,211,238)"
                        : node.isCurrent
                          ? "rgb(34,211,238)"
                          : node.isWorktree
                            ? "rgb(16,185,129)"
                            : "rgba(161,161,170,0.3)"
                    }
                    strokeWidth={isSelected || node.isCurrent ? "2.5" : "1.5"}
                    filter={
                      isSelected
                        ? "url(#glow-selected)"
                        : node.isCurrent
                          ? "url(#glow-cyan)"
                          : node.isWorktree
                            ? "url(#glow-emerald)"
                            : undefined
                    }
                  />

                  {node.isWorktree && (
                    <text x={nodeX} y={y + 1} textAnchor="middle" dominantBaseline="middle" fontSize="9">
                      🌿
                    </text>
                  )}

                  {/* Branch label */}
                  <text
                    x={nodeX + 16}
                    y={y - 6}
                    fill={
                      isSelected
                        ? "rgb(34,211,238)"
                        : node.isWorktree
                          ? "rgb(167,243,208)"
                          : "rgba(161,161,170,0.6)"
                    }
                    fontSize="12"
                    fontWeight={isSelected || node.isWorktree ? "500" : "400"}
                    dominantBaseline="middle"
                  >
                    {node.name}
                  </text>

                  {/* HEAD marker */}
                  {node.isCurrent && (
                    <text
                      x={nodeX + 16 + node.name.length * 7.2 + 8}
                      y={y - 6}
                      fill="rgb(34,211,238)"
                      fontSize="9"
                      fontWeight="700"
                      dominantBaseline="middle"
                    >
                      HEAD
                    </text>
                  )}

                  {/* Status line */}
                  <text x={nodeX + 16} y={y + 10} fontSize="10" dominantBaseline="middle" fill="rgba(161,161,170,0.4)">
                    {node.hasAgent && (
                      <tspan fill="rgb(34,211,238)">● {node.agentStatus || "active"}{"  "}</tspan>
                    )}
                    {node.isDirty && (
                      <tspan fill="rgb(245,158,11)">modified{"  "}</tspan>
                    )}
                    {node.diffSummary && (
                      <tspan>
                        <tspan fill="rgb(52,211,153)">+{node.diffSummary.insertions}</tspan>
                        {" "}
                        <tspan fill="rgb(248,113,113)">-{node.diffSummary.deletions}</tspan>
                        {" "}
                        <tspan fill="rgba(161,161,170,0.4)">{node.diffSummary.files_changed} file{node.diffSummary.files_changed !== 1 ? "s" : ""}</tspan>
                      </tspan>
                    )}
                    {!node.hasAgent && !node.isDirty && !node.diffSummary && !node.isWorktree && (
                      <tspan>branch</tspan>
                    )}
                    {!node.hasAgent && node.isWorktree && !node.isDirty && !node.diffSummary && (
                      <tspan>no agent</tspan>
                    )}
                  </text>
                </g>
              );
            })}

            {branchNodes.length === 0 && (
              <text x={svgWidth / 2} y={TOP_PAD + 60} textAnchor="middle" fill="rgba(161,161,170,0.4)" fontSize="13">
                Only the default branch exists
              </text>
            )}
          </svg>
        </div>

        {/* Action panel (right side) */}
        {activeNode && (
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
                    {" · "}
                    {activeNode.diffSummary.files_changed} file{activeNode.diffSummary.files_changed !== 1 ? "s" : ""}
                  </div>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex flex-col gap-2">
                {/* Worktree actions */}
                {activeNode.isWorktree && activeNode.worktree && (
                  <>
                    <button
                      onClick={() => handleViewDiff(activeNode)}
                      disabled={diffLoading}
                      className="w-full rounded-lg bg-white/5 px-3 py-2 text-left text-xs text-zinc-300 transition-colors hover:bg-white/10 disabled:opacity-50"
                    >
                      {diffLoading ? "Loading..." : "View Diff"}
                    </button>
                    {!activeNode.hasAgent && (
                      <button
                        onClick={() => handleLaunchAgent(activeNode)}
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
                            onClick={() => handleDeleteWorktree(activeNode)}
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
                    {/* Checkout */}
                    {!activeNode.isCurrent && (
                      <button
                        onClick={() => handleCheckout(activeNode.name)}
                        disabled={actionBusy}
                        className="w-full rounded-lg bg-cyan-500/15 px-3 py-2 text-left text-xs font-medium text-cyan-400 transition-colors hover:bg-cyan-500/25 disabled:opacity-50"
                      >
                        {actionBusy ? "..." : "Checkout"}
                      </button>
                    )}
                    {/* Merge into current */}
                    {!activeNode.isCurrent && (
                      <button
                        onClick={() => handleMerge(activeNode.name)}
                        disabled={actionBusy}
                        className="w-full rounded-lg bg-purple-500/15 px-3 py-2 text-left text-xs font-medium text-purple-400 transition-colors hover:bg-purple-500/25 disabled:opacity-50"
                      >
                        {actionBusy ? "..." : `Merge into current`}
                      </button>
                    )}
                    {/* Create branch from this branch */}
                    {!showNewBranch ? (
                      <button
                        onClick={() => setShowNewBranch(true)}
                        className="w-full rounded-lg bg-white/5 px-3 py-2 text-left text-xs text-zinc-300 transition-colors hover:bg-white/10"
                      >
                        Create Branch
                      </button>
                    ) : (
                      <div className="rounded-lg border border-white/10 bg-white/5 p-2">
                        <div className="mb-1 text-[11px] text-zinc-500">
                          from: <span className="text-zinc-300">{activeNode.name}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <input
                            autoFocus
                            type="text"
                            value={newBranchName}
                            onChange={(e) => setNewBranchName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleCreateBranch(activeNode.name);
                              if (e.key === "Escape") { setShowNewBranch(false); setNewBranchName(""); }
                            }}
                            placeholder="branch name"
                            className="flex-1 rounded bg-black/30 px-2 py-1 text-xs text-zinc-200 placeholder-zinc-600 outline-none ring-1 ring-white/20 focus:ring-white/40"
                          />
                          <button
                            onClick={() => handleCreateBranch(activeNode.name)}
                            disabled={!newBranchName.trim() || actionBusy}
                            className="rounded px-2 py-1 text-xs text-zinc-300 hover:bg-white/10 disabled:opacity-30"
                          >
                            Go
                          </button>
                        </div>
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
                            onClick={() => handleDeleteBranch(activeNode)}
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
                    {/* Checkout (if not current) */}
                    {!activeNode.isCurrent && (
                      <button
                        onClick={() => handleCheckout(activeNode.name)}
                        disabled={actionBusy}
                        className="w-full rounded-lg bg-cyan-500/15 px-3 py-2 text-left text-xs font-medium text-cyan-400 transition-colors hover:bg-cyan-500/25 disabled:opacity-50"
                      >
                        {actionBusy ? "..." : "Checkout"}
                      </button>
                    )}
                    {/* Create Branch */}
                    {!showNewBranch ? (
                      <button
                        onClick={() => setShowNewBranch(true)}
                        className="w-full rounded-lg bg-white/5 px-3 py-2 text-left text-xs text-zinc-300 transition-colors hover:bg-white/10"
                      >
                        Create Branch
                      </button>
                    ) : (
                      <div className="rounded-lg border border-white/10 bg-white/5 p-2">
                        <div className="mb-1 text-[11px] text-zinc-500">
                          from: <span className="text-emerald-400">{activeNode.name}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <input
                            autoFocus
                            type="text"
                            value={newBranchName}
                            onChange={(e) => setNewBranchName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleCreateBranch(activeNode.name);
                              if (e.key === "Escape") { setShowNewBranch(false); setNewBranchName(""); }
                            }}
                            placeholder="branch name"
                            className="flex-1 rounded bg-black/30 px-2 py-1 text-xs text-zinc-200 placeholder-zinc-600 outline-none ring-1 ring-white/20 focus:ring-white/40"
                          />
                          <button
                            onClick={() => handleCreateBranch(activeNode.name)}
                            disabled={!newBranchName.trim() || actionBusy}
                            className="rounded px-2 py-1 text-xs text-zinc-300 hover:bg-white/10 disabled:opacity-30"
                          >
                            Go
                          </button>
                        </div>
                      </div>
                    )}
                    {/* Create Worktree */}
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

              {/* Git output */}
              {gitOutput && (
                <div className="mt-3 rounded-lg bg-emerald-500/10 px-3 py-2 text-xs font-mono text-emerald-400">
                  {gitOutput}
                </div>
              )}

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
        )}
      </div>
    </div>
  );
}
