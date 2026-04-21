import { describe, expect, it } from "vitest";
import type { BranchListResponse } from "@/lib/api";
import { computeLaneW, computeLayout, LEFT_PAD } from "../layout";
import type { BranchNode, GraphData } from "../types";

const FIVE_BRANCHES = ["main", "feat-a", "feat-b", "review-63", "review-64"] as const;

function make5LaneBranchInfo(): BranchListResponse {
  return {
    default_branch: "main",
    current_branch: "main",
    branches: [...FIVE_BRANCHES],
    parents: {
      "feat-a": "main",
      "feat-b": "main",
      "review-63": "main",
      "review-64": "main",
    },
    ahead_behind: {},
    remote_tracking: {},
    remote_only_branches: [],
    last_fetch: null,
    last_commit_times: {},
  };
}

function make5LaneGraphData(): GraphData {
  return {
    commits: [
      {
        sha: "abc1234",
        parents: [],
        refs: ["HEAD -> main"],
        subject: "initial commit",
        authored_date: 0,
      },
    ],
  };
}

function make5LaneNodes(): BranchNode[] {
  return FIVE_BRANCHES.map((name, i) => ({
    name,
    parent: name === "main" ? null : "main",
    isWorktree: i > 0,
    isMain: name === "main",
    isCurrent: name === "main",
    isDirty: false,
    hasAgent: false,
    agentTarget: null,
    agentStatus: null,
    diffSummary: null,
    worktree: null,
    ahead: i > 0 ? 1 : 0,
    behind: 0,
    remote: null,
    isRemoteOnly: false,
    lastCommitTime: null,
  }));
}

describe("lane graph spacing — 5 lanes", () => {
  it("computes correct laneW for 5 lanes", () => {
    expect(computeLaneW(5)).toBe(60);
  });

  it("assigns exactly 5 lanes", () => {
    const layout = computeLayout(make5LaneGraphData(), make5LaneBranchInfo(), make5LaneNodes());
    expect(layout.lanes.length).toBe(5);
    expect(layout.laneW).toBe(computeLaneW(5));
  });

  it("lane-0 x-coordinate matches formula: LEFT_PAD + laneW/2", () => {
    const layout = computeLayout(make5LaneGraphData(), make5LaneBranchInfo(), make5LaneNodes());
    const { laneW } = layout;
    // The formula used by LaneGraph: laneX(i) = LEFT_PAD + i*laneW + laneW/2
    const laneX = (i: number) => LEFT_PAD + i * laneW + laneW / 2;
    expect(laneX(0)).toBe(LEFT_PAD + laneW / 2);
  });

  it("inter-lane spacing is uniform (all gaps equal laneW)", () => {
    const layout = computeLayout(make5LaneGraphData(), make5LaneBranchInfo(), make5LaneNodes());
    const { laneW } = layout;
    const laneX = (i: number) => LEFT_PAD + i * laneW + laneW / 2;
    for (let i = 1; i < 5; i++) {
      expect(laneX(i) - laneX(i - 1)).toBe(laneW);
    }
  });

  it("svgWidth has symmetric LEFT_PAD margins on both sides (fix for main-lane detach)", () => {
    const layout = computeLayout(make5LaneGraphData(), make5LaneBranchInfo(), make5LaneNodes());
    const { laneW, svgWidth, lanes } = layout;
    const laneX = (i: number) => LEFT_PAD + i * laneW + laneW / 2;
    const lastIdx = lanes.length - 1;

    // Left margin: distance from SVG left edge to the left edge of lane-0 background
    const leftMargin = laneX(0) - laneW / 2;
    // Right margin: distance from right edge of last lane's background to SVG right edge
    const rightMargin = svgWidth - (laneX(lastIdx) + laneW / 2);

    expect(leftMargin).toBe(LEFT_PAD);
    // Symmetric: right margin must equal left margin so lane 0 is not visually detached
    expect(rightMargin).toBe(LEFT_PAD);
    expect(svgWidth).toBe(2 * LEFT_PAD + lanes.length * laneW);
  });
});
