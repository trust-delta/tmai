import { describe, expect, it } from "vitest";
import type { PrInfo } from "@/lib/api";
import type { BranchNode } from "../graph/types";

// Helper to create a minimal BranchNode with overrides
function makeNode(overrides: Partial<BranchNode> = {}): BranchNode {
  return {
    name: "feat/test",
    parent: "main",
    isWorktree: false,
    isMain: false,
    isCurrent: false,
    isDirty: false,
    hasAgent: false,
    agentTarget: null,
    agentStatus: null,
    diffSummary: null,
    worktree: null,
    ahead: 0,
    behind: 0,
    remote: null,
    isRemoteOnly: false,
    lastCommitTime: null,
    ...overrides,
  };
}

/**
 * Pure logic for identifying which branches are eligible for bulk deletion.
 * Mirrors the `mergedBranches` useMemo in BranchGraph.tsx.
 */
function findMergedBranches(nodes: BranchNode[], prMap: Record<string, PrInfo>): BranchNode[] {
  return nodes.filter((n) => {
    if (n.isMain || n.isCurrent) return false;
    const pr = prMap[n.name];
    return pr?.state === "merged";
  });
}

describe("findMergedBranches (bulk delete candidate detection)", () => {
  it("identifies branches with merged PRs", () => {
    const nodes = [
      makeNode({ name: "main", isMain: true }),
      makeNode({ name: "feat/a" }),
      makeNode({ name: "feat/b" }),
    ];
    const prMap: Record<string, PrInfo> = {
      "feat/a": {
        number: 1,
        title: "A",
        state: "merged",
        head_branch: "feat/a",
        head_sha: "abc",
        base_branch: "main",
        url: "",
        review_decision: null,
        check_status: null,
        is_draft: false,
        additions: 0,
        deletions: 0,
        comments: 0,
        reviews: 0,
      },
    };
    const result = findMergedBranches(nodes, prMap);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("feat/a");
  });

  it("excludes main branch even if it somehow has a merged PR", () => {
    const nodes = [makeNode({ name: "main", isMain: true })];
    const prMap: Record<string, PrInfo> = {
      main: {
        number: 1,
        title: "Main PR",
        state: "merged",
        head_branch: "main",
        head_sha: "abc",
        base_branch: "develop",
        url: "",
        review_decision: null,
        check_status: null,
        is_draft: false,
        additions: 0,
        deletions: 0,
        comments: 0,
        reviews: 0,
      },
    };
    expect(findMergedBranches(nodes, prMap)).toHaveLength(0);
  });

  it("excludes current branch even if merged", () => {
    const nodes = [
      makeNode({ name: "main", isMain: true }),
      makeNode({ name: "feat/current", isCurrent: true }),
    ];
    const prMap: Record<string, PrInfo> = {
      "feat/current": {
        number: 2,
        title: "Current",
        state: "merged",
        head_branch: "feat/current",
        head_sha: "def",
        base_branch: "main",
        url: "",
        review_decision: null,
        check_status: null,
        is_draft: false,
        additions: 0,
        deletions: 0,
        comments: 0,
        reviews: 0,
      },
    };
    expect(findMergedBranches(nodes, prMap)).toHaveLength(0);
  });

  it("excludes branches with open PRs", () => {
    const nodes = [makeNode({ name: "main", isMain: true }), makeNode({ name: "feat/open" })];
    const prMap: Record<string, PrInfo> = {
      "feat/open": {
        number: 3,
        title: "Open",
        state: "open",
        head_branch: "feat/open",
        head_sha: "ghi",
        base_branch: "main",
        url: "",
        review_decision: null,
        check_status: null,
        is_draft: false,
        additions: 0,
        deletions: 0,
        comments: 0,
        reviews: 0,
      },
    };
    expect(findMergedBranches(nodes, prMap)).toHaveLength(0);
  });

  it("excludes branches with no PR info", () => {
    const nodes = [makeNode({ name: "main", isMain: true }), makeNode({ name: "feat/no-pr" })];
    expect(findMergedBranches(nodes, {})).toHaveLength(0);
  });

  it("returns multiple merged branches", () => {
    const nodes = [
      makeNode({ name: "main", isMain: true }),
      makeNode({ name: "feat/a" }),
      makeNode({ name: "feat/b" }),
      makeNode({ name: "feat/c" }),
    ];
    const makePr = (branch: string, num: number, state: string): PrInfo => ({
      number: num,
      title: branch,
      state,
      head_branch: branch,
      head_sha: "sha",
      base_branch: "main",
      url: "",
      review_decision: null,
      check_status: null,
      is_draft: false,
      additions: 0,
      deletions: 0,
      comments: 0,
      reviews: 0,
    });
    const prMap: Record<string, PrInfo> = {
      "feat/a": makePr("feat/a", 1, "merged"),
      "feat/b": makePr("feat/b", 2, "open"),
      "feat/c": makePr("feat/c", 3, "merged"),
    };
    const result = findMergedBranches(nodes, prMap);
    expect(result).toHaveLength(2);
    expect(result.map((n) => n.name).sort()).toEqual(["feat/a", "feat/c"]);
  });
});
