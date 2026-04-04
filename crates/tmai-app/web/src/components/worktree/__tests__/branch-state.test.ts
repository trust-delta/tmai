import { describe, expect, it } from "vitest";
import type { PrInfo } from "@/lib/api";
import { branchStateBadgeClass, branchStateLabel, deriveBranchState } from "../branch-state";
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

// Helper to create a minimal PrInfo with overrides
function makePr(overrides: Partial<PrInfo> = {}): PrInfo {
  return {
    number: 42,
    title: "Test PR",
    state: "open",
    head_branch: "feat/test",
    head_sha: "abc123",
    base_branch: "main",
    url: "https://github.com/test/repo/pull/42",
    review_decision: null,
    check_status: null,
    is_draft: false,
    additions: 10,
    deletions: 5,
    comments: 0,
    reviews: 0,
    ...overrides,
  };
}

describe("deriveBranchState", () => {
  it("returns 'merged' when PR state is merged", () => {
    const node = makeNode({ ahead: 0, behind: 0 });
    const pr = makePr({ state: "merged", merge_commit_sha: "def456" });
    expect(deriveBranchState(node, pr)).toBe("merged");
  });

  it("returns 'merged' even if branch has agent (merged takes priority)", () => {
    const node = makeNode({ hasAgent: true });
    const pr = makePr({ state: "merged" });
    expect(deriveBranchState(node, pr)).toBe("merged");
  });

  it("returns 'merged' even if branch is behind (merged takes priority)", () => {
    const node = makeNode({ behind: 3, ahead: 0 });
    const pr = makePr({ state: "merged" });
    expect(deriveBranchState(node, pr)).toBe("merged");
  });

  it("returns 'has-open-pr' when PR state is open", () => {
    const node = makeNode({ ahead: 2 });
    const pr = makePr({ state: "open" });
    expect(deriveBranchState(node, pr)).toBe("has-open-pr");
  });

  it("returns 'has-open-pr' even if agent is active (open-pr takes priority over active)", () => {
    const node = makeNode({ hasAgent: true, ahead: 1 });
    const pr = makePr({ state: "open" });
    expect(deriveBranchState(node, pr)).toBe("has-open-pr");
  });

  it("returns 'active' when agent is running and no PR", () => {
    const node = makeNode({ hasAgent: true, agentTarget: "claude", agentStatus: "in-progress" });
    expect(deriveBranchState(node)).toBe("active");
  });

  it("returns 'active' when agent is running and PR is closed (not merged)", () => {
    const node = makeNode({ hasAgent: true });
    const pr = makePr({ state: "closed" });
    expect(deriveBranchState(node, pr)).toBe("active");
  });

  it("returns 'stale' when behind main with no agent and no new commits", () => {
    const node = makeNode({ behind: 5, ahead: 0, hasAgent: false });
    expect(deriveBranchState(node)).toBe("stale");
  });

  it("returns 'default' when behind but has commits ahead (not stale)", () => {
    const node = makeNode({ behind: 2, ahead: 3, hasAgent: false });
    expect(deriveBranchState(node)).toBe("default");
  });

  it("returns 'default' for a normal working branch", () => {
    const node = makeNode({ ahead: 1, behind: 0 });
    expect(deriveBranchState(node)).toBe("default");
  });

  it("returns 'default' when no PR and no agent and not behind", () => {
    const node = makeNode();
    expect(deriveBranchState(node)).toBe("default");
  });

  it("returns 'default' when prInfo is undefined", () => {
    const node = makeNode({ ahead: 2 });
    expect(deriveBranchState(node, undefined)).toBe("default");
  });
});

describe("branchStateLabel", () => {
  it("returns correct labels", () => {
    expect(branchStateLabel("merged")).toBe("Merged");
    expect(branchStateLabel("has-open-pr")).toBe("PR Open");
    expect(branchStateLabel("active")).toBe("Active");
    expect(branchStateLabel("stale")).toBe("Stale");
    expect(branchStateLabel("default")).toBe("");
  });
});

describe("branchStateBadgeClass", () => {
  it("returns non-empty classes for non-default states", () => {
    expect(branchStateBadgeClass("merged")).toContain("purple");
    expect(branchStateBadgeClass("has-open-pr")).toContain("blue");
    expect(branchStateBadgeClass("active")).toContain("cyan");
    expect(branchStateBadgeClass("stale")).toContain("amber");
  });

  it("returns empty string for default state", () => {
    expect(branchStateBadgeClass("default")).toBe("");
  });
});
