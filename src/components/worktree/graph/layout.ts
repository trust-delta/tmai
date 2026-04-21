import type { BranchListResponse } from "@/lib/api";
import { laneColor } from "./colors";
import type {
  BranchNode,
  CommitRow,
  Connection,
  FoldRow,
  GraphCommit,
  GraphData,
  LaneInfo,
  LaneLayout,
  RowInfo,
} from "./types";

// Layout constants
export const MIN_LANE_W = 24;
export const MAX_LANE_W = 80;
export const ROW_H = 32;
export const HEADER_H = 52;
export const COMMIT_R = 4;
export const BRANCH_R = 7;
export const LEFT_PAD = 20;

// Graph area target width for lane width calculation
const GRAPH_AREA_TARGET = 300;

/// Compute dynamic lane width based on number of lanes
export function computeLaneW(laneCount: number): number {
  if (laneCount <= 1) return MAX_LANE_W;
  return Math.max(MIN_LANE_W, Math.min(MAX_LANE_W, Math.floor(GRAPH_AREA_TARGET / laneCount)));
}

/// Strip ref decoration prefixes to get bare branch name.
/// Remote tracking refs (origin/...) are mapped to their local branch name
/// so that commits only on the remote (not yet pulled) are assigned correctly.
function stripRefPrefix(ref: string): string | null {
  if (ref.startsWith("HEAD -> ")) return ref.slice(8);
  if (ref.startsWith("tag: ")) return null;
  // Map origin/branch-name → branch-name (e.g. origin/dev/tmai-app → dev/tmai-app)
  if (ref.startsWith("origin/")) return ref.slice(7);
  // Skip other ref types (refs/stash, etc.)
  if (ref.startsWith("refs/")) return null;
  return ref;
}

/// Get depth of a branch from default branch via parent map
function getDepth(branch: string, parents: Record<string, string>, defaultBranch: string): number {
  let depth = 0;
  let current = branch;
  const visited = new Set<string>();
  while (current !== defaultBranch && !visited.has(current)) {
    visited.add(current);
    const parent = parents[current];
    if (!parent) break;
    current = parent;
    depth++;
  }
  return depth;
}

// ── Sub-function 1: Assign commits to branches ──

/// Walk commits and determine which branch each commit belongs to.
/// Parent branches take priority over child branches for shared commits.
function assignCommitsToBranches(
  commits: GraphCommit[],
  branchInfo: BranchListResponse,
  _defaultBranch: string,
): { shaToBranch: Map<string, string>; branchTipSha: Map<string, string> } {
  const shaIdx = new Map<string, number>();
  for (const [i, c] of commits.entries()) {
    shaIdx.set(c.sha, i);
  }

  const shaToBranch = new Map<string, string>();
  const branchTipSha = new Map<string, string>();
  const parentMap = branchInfo.parents;

  // First pass: assign by refs
  for (const commit of commits) {
    for (const ref of commit.refs) {
      const branch = stripRefPrefix(ref);
      if (branch && branchInfo.branches.includes(branch)) {
        shaToBranch.set(commit.sha, branch);
        if (!branchTipSha.has(branch)) {
          branchTipSha.set(branch, commit.sha);
        }
      }
    }
  }

  // Resolve ancestry depth so parent branches are processed first.
  // `visited` guards against `parentMap` cycles (e.g. `A → B → A` introduced
  // by a misdetected worktree/branch relationship). Without it this loop
  // hangs the tab the instant BranchGraph mounts on a repo that happens to
  // have such a cycle — which is the "Chrome goes Not responding when I
  // open Branch graph" symptom users have been reporting.
  const branchDepth = (b: string): number => {
    let d = 0;
    let cur = b;
    const visited = new Set<string>();
    while (parentMap[cur] && !visited.has(cur)) {
      visited.add(cur);
      cur = parentMap[cur];
      d++;
    }
    return d;
  };
  const sortedTips = [...branchTipSha.entries()].sort(
    (a, b) => branchDepth(a[0]) - branchDepth(b[0]),
  );

  // Walk parent chains to assign branch ownership
  for (const [branch, tipSha] of sortedTips) {
    let currentSha = tipSha;
    const visited = new Set<string>();
    while (currentSha && !visited.has(currentSha)) {
      visited.add(currentSha);
      const idx = shaIdx.get(currentSha);
      if (idx === undefined) break;
      const commit = commits[idx];
      const existing = shaToBranch.get(currentSha);
      if (existing && existing !== branch) {
        // Already owned by another branch — only reclaim if this branch is its parent
        if (parentMap[existing] === branch) {
          shaToBranch.set(currentSha, branch);
        } else {
          break;
        }
      } else {
        shaToBranch.set(currentSha, branch);
      }
      if (commit.parents.length > 0) {
        currentSha = commit.parents[0];
      } else {
        break;
      }
    }
  }

  return { shaToBranch, branchTipSha };
}

// ── Sub-function 2: Assign lanes to branches ──

/// Sort branches and assign lane indices.
function assignLanes(
  branchInfo: BranchListResponse,
  activeNodes: BranchNode[],
  defaultBranch: string,
): { branchToLane: Map<string, number>; sortedBranches: string[] } {
  const activeSet = new Set(
    activeNodes
      .filter((n) => n.isWorktree || n.hasAgent || n.isDirty || n.ahead > 0 || n.isCurrent)
      .map((n) => n.name),
  );
  const parentMap = branchInfo.parents;
  const branchesInGraph = new Set<string>(branchInfo.branches);

  const sortedBranches: string[] = [];
  if (branchesInGraph.has(defaultBranch)) {
    sortedBranches.push(defaultBranch);
  }
  const activeBranches = [...branchesInGraph]
    .filter((b) => b !== defaultBranch && activeSet.has(b))
    .sort((a, b) => getDepth(a, parentMap, defaultBranch) - getDepth(b, parentMap, defaultBranch));
  sortedBranches.push(...activeBranches);
  const inactiveBranches = [...branchesInGraph]
    .filter((b) => b !== defaultBranch && !activeSet.has(b))
    .sort();
  sortedBranches.push(...inactiveBranches);

  const branchToLane = new Map<string, number>();
  for (const [i, b] of sortedBranches.entries()) {
    branchToLane.set(b, i);
  }

  return { branchToLane, sortedBranches };
}

// ── Sub-function 3: Classify visibility ──

interface CommitInfo {
  sha: string;
  branch: string;
  lane: number;
  subject: string;
  refs: string[];
  isMerge: boolean;
  isTip: boolean;
  visible: boolean;
}

/// Classify each commit as visible or hidden based on collapse state.
function classifyVisibility(
  commits: GraphCommit[],
  shaToBranch: Map<string, string>,
  branchToLane: Map<string, number>,
  collapsed: Set<string>,
  tipShaSet: Set<string>,
  defaultBranch: string,
): CommitInfo[] {
  const commitInfos: CommitInfo[] = [];

  for (const commit of commits) {
    const branch = shaToBranch.get(commit.sha) ?? defaultBranch;
    const lane = branchToLane.get(branch) ?? 0;
    const isTip = tipShaSet.has(commit.sha);
    const isMerge = commit.parents.length > 1;
    // A commit with cross-lane parents (fork point) should stay visible
    const hasCrossLaneParent = commit.parents.some((p) => {
      const pb = shaToBranch.get(p) ?? defaultBranch;
      return (branchToLane.get(pb) ?? 0) !== lane;
    });

    const isCollapsedLane = collapsed.has(branch);
    const hasRefs = commit.refs.length > 0;
    const visible = !isCollapsedLane || isTip || isMerge || hasCrossLaneParent || hasRefs;

    commitInfos.push({
      sha: commit.sha,
      branch,
      lane,
      subject: commit.subject,
      refs: commit.refs,
      isMerge,
      isTip,
      visible,
    });
  }

  return commitInfos;
}

// ── Sub-function 4: Build rows ──

/// Build row layout from classified commits, inserting fold indicators for hidden runs.
function buildRows(commitInfos: CommitInfo[]): {
  rows: RowInfo[];
  shaToY: Map<string, number>;
  finalY: number;
} {
  const rows: RowInfo[] = [];
  const shaToY = new Map<string, number>();
  let currentY = HEADER_H;

  // Track consecutive hidden commits per lane to create fold indicators
  const hiddenRun = new Map<number, number>();

  for (let i = 0; i < commitInfos.length; i++) {
    const info = commitInfos[i];

    if (!info.visible) {
      hiddenRun.set(info.lane, (hiddenRun.get(info.lane) ?? 0) + 1);
      continue;
    }

    // Before showing this visible commit, emit fold indicators for accumulated hidden runs
    const hiddenCount = hiddenRun.get(info.lane) ?? 0;
    if (hiddenCount > 0) {
      const fold: FoldRow = {
        kind: "fold",
        sha: `__fold_${info.lane}_${i}`,
        lane: info.lane,
        y: currentY,
        foldCount: hiddenCount,
      };
      rows.push(fold);
      currentY += ROW_H;
      hiddenRun.set(info.lane, 0);
    }

    shaToY.set(info.sha, currentY);
    const row: CommitRow = {
      kind: "commit",
      sha: info.sha,
      lane: info.lane,
      y: currentY,
      subject: info.subject,
      refs: info.refs,
      isMerge: info.isMerge,
    };
    rows.push(row);
    currentY += ROW_H;
  }

  // Flush remaining hidden runs at the end
  for (const [lane, count] of hiddenRun) {
    if (count > 0) {
      const fold: FoldRow = {
        kind: "fold",
        sha: `__fold_end_${lane}`,
        lane,
        y: currentY,
        foldCount: count,
      };
      rows.push(fold);
      currentY += ROW_H;
    }
  }

  return { rows, shaToY, finalY: currentY };
}

// ── Sub-function 5: Build connections ──

/// Build cross-lane connection lines (fork/merge).
function buildConnections(
  commits: GraphCommit[],
  rows: RowInfo[],
  shaToY: Map<string, number>,
  shaToBranch: Map<string, string>,
  branchToLane: Map<string, number>,
  defaultBranch: string,
): Connection[] {
  // Resolve Y for hidden commits via their lane's fold indicator
  const effectiveY = (sha: string, lane: number): number | undefined => {
    const direct = shaToY.get(sha);
    if (direct !== undefined) return direct;
    // Hidden commit — find the fold indicator row for this lane that's closest
    const foldRow = rows.find((r) => r.kind === "fold" && r.lane === lane);
    return foldRow?.y;
  };

  const connections: Connection[] = [];

  for (const commit of commits) {
    const childBranch = shaToBranch.get(commit.sha) ?? defaultBranch;
    const childLane = branchToLane.get(childBranch) ?? 0;
    const childY = effectiveY(commit.sha, childLane);
    if (childY === undefined) continue;

    for (let pi = 0; pi < commit.parents.length; pi++) {
      const parentSha = commit.parents[pi];
      const parentBranch = shaToBranch.get(parentSha) ?? defaultBranch;
      const parentLane = branchToLane.get(parentBranch) ?? 0;
      const parentY = effectiveY(parentSha, parentLane);
      if (parentY === undefined) continue;
      if (childLane === parentLane) continue;

      if (pi === 0) {
        connections.push({
          fromLane: parentLane,
          toLane: childLane,
          fromY: parentY,
          toY: childY,
          type: "fork",
          color: laneColor(childLane),
        });
      } else {
        connections.push({
          fromLane: parentLane,
          toLane: childLane,
          fromY: parentY,
          toY: childY,
          type: "merge",
          color: laneColor(parentLane),
        });
      }
    }
  }

  return connections;
}

// ── Orchestrator ──

/// Compute lane-based layout from graph data and branch metadata.
/// collapsedLanes: set of branch names whose intermediate commits are folded.
export function computeLayout(
  graphData: GraphData,
  branchInfo: BranchListResponse,
  activeNodes: BranchNode[],
  collapsedLanes?: Set<string>,
): LaneLayout {
  const defaultBranch = branchInfo.default_branch;
  const commits = graphData.commits;
  const collapsed = collapsedLanes ?? new Set<string>();

  if (commits.length === 0) {
    return {
      lanes: [],
      rows: [],
      connections: [],
      laneW: MAX_LANE_W,
      svgWidth: 200,
      svgHeight: 100,
    };
  }

  // Step 1: Assign commits to branches
  const { shaToBranch, branchTipSha } = assignCommitsToBranches(commits, branchInfo, defaultBranch);

  // Step 2: Assign lanes
  const activeSet = new Set(
    activeNodes
      .filter((n) => n.isWorktree || n.hasAgent || n.isDirty || n.ahead > 0 || n.isCurrent)
      .map((n) => n.name),
  );

  const { branchToLane, sortedBranches } = assignLanes(branchInfo, activeNodes, defaultBranch);
  const totalLanes = sortedBranches.length || 1;

  // Step 3: Build lane info
  const lanes: LaneInfo[] = sortedBranches.map((branch, i) => ({
    branch,
    laneIndex: i,
    color: laneColor(i),
    isActive: activeSet.has(branch) || branch === defaultBranch,
  }));

  // Step 4: Classify visibility
  const tipShaSet = new Set(branchTipSha.values());
  const commitInfos = classifyVisibility(
    commits,
    shaToBranch,
    branchToLane,
    collapsed,
    tipShaSet,
    defaultBranch,
  );

  // Step 5: Build rows
  const { rows, shaToY, finalY } = buildRows(commitInfos);

  // Step 6: Build connections
  const connections = buildConnections(
    commits,
    rows,
    shaToY,
    shaToBranch,
    branchToLane,
    defaultBranch,
  );

  const laneW = computeLaneW(totalLanes);
  // Symmetric padding: equal LEFT_PAD on both sides so lane 0's left margin
  // matches lane N-1's right margin — prevents lane 0 from looking detached.
  // The old formula included +500 for a label area that is now rendered in HTML.
  const svgWidth = 2 * LEFT_PAD + totalLanes * laneW;
  const svgHeight = finalY + 40;

  return { lanes, rows, connections, laneW, svgWidth, svgHeight };
}
