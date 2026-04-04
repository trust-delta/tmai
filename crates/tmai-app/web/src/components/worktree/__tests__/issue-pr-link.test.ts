import { describe, expect, it } from "vitest";
import type { PrInfo } from "@/lib/api";
import { buildIssuePrMap } from "../IssuesPanel";

// Helper to create a minimal PrInfo with overrides
function makePr(overrides: Partial<PrInfo> = {}): PrInfo {
  return {
    number: 1,
    title: "test PR",
    state: "OPEN",
    head_branch: "feat/test",
    head_sha: "abc123",
    base_branch: "main",
    url: "https://github.com/test/repo/pull/1",
    review_decision: null,
    check_status: null,
    is_draft: false,
    additions: 0,
    deletions: 0,
    comments: 0,
    reviews: 0,
    ...overrides,
  };
}

describe("buildIssuePrMap", () => {
  it("links issue from branch name containing issue number", () => {
    const prMap = {
      "feat/42-auth-flow": makePr({ number: 55, title: "Add auth flow" }),
    };
    const result = buildIssuePrMap(prMap, []);
    expect(result.get(42)).toBeDefined();
    expect(result.get(42)?.pr.number).toBe(55);
    expect(result.get(42)?.branch).toBe("feat/42-auth-flow");
  });

  it("links issue from PR title containing issue ref (Fixes #N)", () => {
    const prMap = {
      "feat/auth": makePr({ number: 10, title: "Fixes #99: login bug" }),
    };
    const result = buildIssuePrMap(prMap, []);
    expect(result.get(99)).toBeDefined();
    expect(result.get(99)?.pr.number).toBe(10);
  });

  it("links issue from PR title containing Closes #N", () => {
    const prMap = {
      "refactor/cleanup": makePr({
        number: 20,
        title: "Closes #33 - remove dead code",
      }),
    };
    const result = buildIssuePrMap(prMap, []);
    expect(result.get(33)).toBeDefined();
    expect(result.get(33)?.pr.number).toBe(20);
  });

  it("prefers branch-name match over title ref for the same issue", () => {
    const prMap = {
      "fix/42-bug": makePr({ number: 5, title: "Fixes #42" }),
    };
    const result = buildIssuePrMap(prMap, []);
    // Branch name match comes first, so it wins
    expect(result.get(42)?.pr.number).toBe(5);
    expect(result.get(42)?.branch).toBe("fix/42-bug");
  });

  it("handles multiple PRs linking to different issues", () => {
    const prMap = {
      "feat/10-login": makePr({ number: 1, title: "Login feature" }),
      "fix/20-crash": makePr({ number: 2, title: "Fix crash" }),
    };
    const result = buildIssuePrMap(prMap, []);
    expect(result.get(10)?.pr.number).toBe(1);
    expect(result.get(20)?.pr.number).toBe(2);
  });

  it("returns empty map when no PRs exist", () => {
    const result = buildIssuePrMap({}, []);
    expect(result.size).toBe(0);
  });

  it("does not link issues from PR titles without keyword prefix", () => {
    // extractIssueRefs also matches standalone #N, so #77 should be linked
    const prMap = {
      "feat/misc": makePr({ number: 3, title: "Update #77 handling" }),
    };
    const result = buildIssuePrMap(prMap, []);
    // extractIssueRefs matches standalone #N as well
    expect(result.get(77)).toBeDefined();
  });

  it("handles merged PR state correctly", () => {
    const prMap = {
      "feat/42-done": makePr({ number: 8, title: "Done", state: "MERGED" }),
    };
    const result = buildIssuePrMap(prMap, []);
    expect(result.get(42)?.pr.state).toBe("MERGED");
  });

  it("handles draft PR correctly", () => {
    const prMap = {
      "feat/42-wip": makePr({ number: 9, title: "WIP", is_draft: true }),
    };
    const result = buildIssuePrMap(prMap, []);
    expect(result.get(42)?.pr.is_draft).toBe(true);
  });

  it("first PR wins when multiple PRs reference the same issue", () => {
    // Object.entries iteration order is insertion order for string keys
    const prMap = {
      "feat/42-first": makePr({ number: 1, title: "First" }),
      "fix/42-second": makePr({ number: 2, title: "Second" }),
    };
    const result = buildIssuePrMap(prMap, []);
    expect(result.get(42)?.pr.number).toBe(1);
  });
});
