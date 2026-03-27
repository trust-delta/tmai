import type { GraphData, LaneLayout, LaneInfo, RowInfo, Connection, BranchNode } from "./types";
import type { BranchListResponse } from "@/lib/api";
import { laneColor } from "./colors";

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

/// Strip ref decoration prefixes to get bare branch name
function stripRefPrefix(ref: string): string | null {
  if (ref.startsWith("HEAD -> ")) return ref.slice(8);
  if (ref.startsWith("tag: ")) return null;
  if (ref.includes("/")) {
    const parts = ref.split("/");
    if (parts[0] === "origin" || parts[0] === "refs") return null;
  }
  return ref;
}

/// Compute lane-based layout from graph data and branch metadata
///
/// collapsedLanes: set of branch names whose intermediate commits are folded
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
    return { lanes: [], rows: [], connections: [], laneW: MAX_LANE_W, svgWidth: 200, svgHeight: 100 };
  }

  // Step 1: Build SHA -> commit index map
  const shaIdx = new Map<string, number>();
  commits.forEach((c, i) => shaIdx.set(c.sha, i));

  // Step 2: Determine which branch each commit belongs to
  const shaToBranch = new Map<string, string>();
  const branchTipSha = new Map<string, string>();

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

  // Walk parent chains to assign branch ownership.
  // Parent branches take priority: if a commit is shared between parent and child,
  // it belongs to the parent's lane. Child lanes only contain unique commits.
  const parentMap = branchInfo.parents;

  // Resolve ancestry depth so parent branches are processed first
  const branchDepth = (b: string): number => {
    let d = 0;
    let cur = b;
    while (parentMap[cur]) { cur = parentMap[cur]; d++; }
    return d;
  };
  const sortedTips = [...branchTipSha.entries()]
    .sort((a, b) => branchDepth(a[0]) - branchDepth(b[0]));

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

  // Step 3: Assign lanes to branches
  const activeSet = new Set(
    activeNodes
      .filter(n => n.isWorktree || n.hasAgent || n.isDirty || n.ahead > 0 || n.isCurrent)
      .map(n => n.name)
  );

  // Use all known branches for lane assignment, not just those with owned commits.
  // Branches with 0 unique commits (e.g. just-created worktrees) still get a lane.
  const branchesInGraph = new Set<string>(branchInfo.branches);

  const sortedBranches: string[] = [];
  if (branchesInGraph.has(defaultBranch)) {
    sortedBranches.push(defaultBranch);
  }
  const activeBranches = [...branchesInGraph]
    .filter(b => b !== defaultBranch && activeSet.has(b))
    .sort((a, b) => getDepth(a, parentMap, defaultBranch) - getDepth(b, parentMap, defaultBranch));
  sortedBranches.push(...activeBranches);
  const inactiveBranches = [...branchesInGraph]
    .filter(b => b !== defaultBranch && !activeSet.has(b))
    .sort();
  sortedBranches.push(...inactiveBranches);

  const branchToLane = new Map<string, number>();
  sortedBranches.forEach((b, i) => branchToLane.set(b, i));

  const totalLanes = sortedBranches.length || 1;

  // Step 4: Build lane info
  const lanes: LaneInfo[] = sortedBranches.map((branch, i) => ({
    branch,
    laneIndex: i,
    color: laneColor(i),
    isActive: activeSet.has(branch) || branch === defaultBranch,
  }));

  // Step 5: Build rows with collapsing support
  // First pass: classify commits and identify tips
  const tipShaSet = new Set(branchTipSha.values());

  // Identify which commits to show vs fold
  // For collapsed lanes: show tip, merge commits, and commits with cross-lane connections,
  // fold the rest into a single indicator
  const commitInfos: Array<{
    sha: string;
    branch: string;
    lane: number;
    subject: string;
    refs: string[];
    isMerge: boolean;
    isTip: boolean;
    visible: boolean;
  }> = [];

  for (const commit of commits) {
    const branch = shaToBranch.get(commit.sha) ?? defaultBranch;
    const lane = branchToLane.get(branch) ?? 0;
    const isTip = tipShaSet.has(commit.sha);
    const isMerge = commit.parents.length > 1;
    // A commit with cross-lane parents (fork point) should stay visible
    const hasCrossLaneParent = commit.parents.some(p => {
      const pb = shaToBranch.get(p) ?? defaultBranch;
      return (branchToLane.get(pb) ?? 0) !== lane;
    });

    const isCollapsedLane = collapsed.has(branch);
    const visible = !isCollapsedLane || isTip || isMerge || hasCrossLaneParent;

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

  // Second pass: build rows, inserting fold indicators for hidden runs
  const rows: RowInfo[] = [];
  const shaToY = new Map<string, number>();
  let currentY = HEADER_H;

  // Track consecutive hidden commits per lane to create fold indicators
  const hiddenRun = new Map<number, number>(); // lane -> count of hidden

  for (let i = 0; i < commitInfos.length; i++) {
    const info = commitInfos[i];

    if (!info.visible) {
      hiddenRun.set(info.lane, (hiddenRun.get(info.lane) ?? 0) + 1);
      // Map this hidden commit's SHA to the fold indicator's Y (will be set when fold is emitted)
      continue;
    }

    // Before showing this visible commit, emit fold indicators for any accumulated hidden runs
    // Check if there's a hidden run for THIS lane that needs flushing
    const hiddenCount = hiddenRun.get(info.lane) ?? 0;
    if (hiddenCount > 0) {
      rows.push({
        sha: `__fold_${info.lane}_${i}`,
        lane: info.lane,
        y: currentY,
        subject: "",
        refs: [],
        isMerge: false,
        isFold: true,
        foldCount: hiddenCount,
      });
      currentY += ROW_H;
      hiddenRun.set(info.lane, 0);
    }

    // Also flush any OTHER lane hidden runs that have been accumulating
    // (these are interleaved with visible commits from other lanes)
    // We don't flush them individually — they'll be flushed when their lane's next visible commit appears

    shaToY.set(info.sha, currentY);
    rows.push({
      sha: info.sha,
      lane: info.lane,
      y: currentY,
      subject: info.subject,
      refs: info.refs,
      isMerge: info.isMerge,
    });
    currentY += ROW_H;
  }

  // Flush remaining hidden runs at the end
  for (const [lane, count] of hiddenRun) {
    if (count > 0) {
      rows.push({
        sha: `__fold_end_${lane}`,
        lane,
        y: currentY,
        subject: "",
        refs: [],
        isMerge: false,
        isFold: true,
        foldCount: count,
      });
      currentY += ROW_H;
    }
  }

  // Step 6: Build connections
  // We need to map hidden SHAs to the nearest visible Y for their lane
  // Build a lookup: for each commit, find its Y (either direct or fold indicator)
  const effectiveY = (sha: string, lane: number): number | undefined => {
    const direct = shaToY.get(sha);
    if (direct !== undefined) return direct;
    // Hidden commit — find the fold indicator row for this lane that's closest
    const foldRow = rows.find(r => r.isFold && r.lane === lane);
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

  const laneW = computeLaneW(totalLanes);
  const svgWidth = Math.max(LEFT_PAD + totalLanes * laneW + 500, 600);
  const svgHeight = currentY + 40;

  return { lanes, rows, connections, laneW, svgWidth, svgHeight };
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
