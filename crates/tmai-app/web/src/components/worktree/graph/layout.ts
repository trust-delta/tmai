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
  // HEAD -> main, origin/main, tag: v1.0
  if (ref.startsWith("HEAD -> ")) return ref.slice(8);
  if (ref.startsWith("tag: ")) return null; // skip tags for now
  if (ref.includes("/")) {
    // origin/feat/foo -> skip remote refs
    const parts = ref.split("/");
    if (parts[0] === "origin" || parts[0] === "refs") return null;
  }
  return ref;
}

/// Compute lane-based layout from graph data and branch metadata
export function computeLayout(
  graphData: GraphData,
  branchInfo: BranchListResponse,
  activeNodes: BranchNode[],
): LaneLayout {
  const defaultBranch = branchInfo.default_branch;
  const commits = graphData.commits;

  if (commits.length === 0) {
    return { lanes: [], rows: [], connections: [], laneW: MAX_LANE_W, svgWidth: 200, svgHeight: 100 };
  }

  // Step 1: Build SHA -> commit index map
  const shaIdx = new Map<string, number>();
  commits.forEach((c, i) => shaIdx.set(c.sha, i));

  // Step 2: Determine which branch each commit belongs to
  // First, build ref -> branch mapping from commit decorations
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

  // Walk parent chains to assign branch ownership to unlabeled commits
  // Start from branch tips and walk down
  for (const [branch, tipSha] of branchTipSha) {
    let currentSha = tipSha;
    const visited = new Set<string>();
    while (currentSha && !visited.has(currentSha)) {
      visited.add(currentSha);
      const idx = shaIdx.get(currentSha);
      if (idx === undefined) break;
      const commit = commits[idx];
      // Stop if this commit already belongs to another branch (merge base)
      if (shaToBranch.has(currentSha) && shaToBranch.get(currentSha) !== branch) break;
      shaToBranch.set(currentSha, branch);
      // Follow first parent (linear history)
      if (commit.parents.length > 0) {
        currentSha = commit.parents[0];
      } else {
        break;
      }
    }
  }

  // Step 3: Assign lanes to branches
  // Priority: main=0, then active branches (worktree/agent/dirty/ahead), then rest
  const activeSet = new Set(
    activeNodes
      .filter(n => n.isWorktree || n.hasAgent || n.isDirty || n.ahead > 0 || n.isCurrent)
      .map(n => n.name)
  );

  const branchesInGraph = new Set<string>();
  for (const [, branch] of shaToBranch) {
    branchesInGraph.add(branch);
  }

  // Sort branches: default first, then active, then rest
  const sortedBranches: string[] = [];
  if (branchesInGraph.has(defaultBranch)) {
    sortedBranches.push(defaultBranch);
  }
  // Active branches next (by parent relationship)
  const parentMap = branchInfo.parents;
  const activeBranches = [...branchesInGraph]
    .filter(b => b !== defaultBranch && activeSet.has(b))
    .sort((a, b) => {
      // Sort by parent depth from default branch
      const depthA = getDepth(a, parentMap, defaultBranch);
      const depthB = getDepth(b, parentMap, defaultBranch);
      return depthA - depthB;
    });
  sortedBranches.push(...activeBranches);

  // Inactive branches
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

  // Step 5: Build rows (commits in topo order)
  const rows: RowInfo[] = [];
  const shaToY = new Map<string, number>();

  commits.forEach((commit, i) => {
    const branch = shaToBranch.get(commit.sha) ?? defaultBranch;
    const lane = branchToLane.get(branch) ?? 0;
    const y = HEADER_H + i * ROW_H;
    shaToY.set(commit.sha, y);

    rows.push({
      sha: commit.sha,
      lane,
      y,
      subject: commit.subject,
      refs: commit.refs,
      isMerge: commit.parents.length > 1,
    });
  });

  // Step 6: Build connections (fork/merge curves)
  const connections: Connection[] = [];

  for (const commit of commits) {
    const childY = shaToY.get(commit.sha);
    const childBranch = shaToBranch.get(commit.sha) ?? defaultBranch;
    const childLane = branchToLane.get(childBranch) ?? 0;

    if (childY === undefined) continue;

    for (let pi = 0; pi < commit.parents.length; pi++) {
      const parentSha = commit.parents[pi];
      const parentY = shaToY.get(parentSha);
      const parentBranch = shaToBranch.get(parentSha) ?? defaultBranch;
      const parentLane = branchToLane.get(parentBranch) ?? 0;

      if (parentY === undefined) continue;
      if (childLane === parentLane) continue; // Same lane = just vertical line

      if (pi === 0) {
        // First parent, different lane = fork
        connections.push({
          fromLane: parentLane,
          toLane: childLane,
          fromY: parentY,
          toY: childY,
          type: "fork",
          color: laneColor(childLane),
        });
      } else {
        // Second+ parent = merge
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
  const svgHeight = HEADER_H + commits.length * ROW_H + 40;

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
