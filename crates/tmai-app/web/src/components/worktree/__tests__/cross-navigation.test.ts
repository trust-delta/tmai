import { describe, expect, it } from "vitest";
import type { PrInfo, WorktreeSnapshot } from "@/lib/api";
import { extractIssueNumbers, extractIssueRefs } from "@/lib/issue-utils";
import { buildIssuePrMap } from "../IssuesPanel";

// Helper to create a minimal PrInfo
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

// Helper to create a minimal WorktreeSnapshot
function makeWorktree(overrides: Partial<WorktreeSnapshot> = {}): WorktreeSnapshot {
  return {
    repo_name: "test",
    repo_path: "/test",
    name: "test-wt",
    path: "/test/.worktrees/test-wt",
    branch: null,
    is_main: false,
    agent_target: null,
    agent_status: null,
    is_dirty: false,
    diff_summary: null,
    ...overrides,
  };
}

describe("cross-navigation: issue → branch matching", () => {
  it("extracts issue number from branch prefix (e.g., 296-refactor-...)", () => {
    const nums = extractIssueNumbers("296-refactor-approval-type");
    expect(nums).toContain(296);
  });

  it("extracts issue number from branch with prefix path (e.g., fix/123-desc)", () => {
    const nums = extractIssueNumbers("fix/123-description");
    expect(nums).toContain(123);
  });

  it("extracts multiple issue numbers from branch name", () => {
    const nums = extractIssueNumbers("42-merge-50-refactor");
    expect(nums).toContain(42);
    expect(nums).toContain(50);
  });

  it("returns empty array for branch with no issue number", () => {
    const nums = extractIssueNumbers("feature-no-number");
    expect(nums).toEqual([]);
  });

  it("ignores numbers >= 100000", () => {
    const nums = extractIssueNumbers("fix/100001-desc");
    expect(nums).toEqual([]);
  });
});

describe("cross-navigation: issue → PR matching", () => {
  it("maps issue to PR via branch name containing issue number", () => {
    const prMap = {
      "313-feat-cross-nav": makePr({ number: 50, title: "Cross nav" }),
    };
    const result = buildIssuePrMap(prMap, []);
    expect(result.get(313)?.pr.number).toBe(50);
    expect(result.get(313)?.branch).toBe("313-feat-cross-nav");
  });

  it("maps issue to PR via 'Closes #N' in PR title", () => {
    const prMap = {
      "feat/misc": makePr({ number: 10, title: "Closes #42 cross-nav" }),
    };
    const result = buildIssuePrMap(prMap, []);
    expect(result.get(42)?.pr.number).toBe(10);
  });

  it("maps issue to PR via 'Resolves #N' in PR title", () => {
    const prMap = {
      "feat/misc": makePr({ number: 15, title: "Resolves #88" }),
    };
    const result = buildIssuePrMap(prMap, []);
    expect(result.get(88)?.pr.number).toBe(15);
  });
});

describe("cross-navigation: PR → issue extraction", () => {
  it("extracts issue numbers from PR head branch", () => {
    const nums = extractIssueNumbers("313-feat-cross-navigation");
    expect(nums).toContain(313);
  });

  it("extracts issue refs from PR title with Fixes keyword", () => {
    const refs = extractIssueRefs("Fixes #42: bug in login");
    expect(refs).toContain(42);
  });

  it("extracts issue refs from PR title with Closes keyword", () => {
    const refs = extractIssueRefs("Closes #99");
    expect(refs).toContain(99);
  });

  it("extracts standalone #N references from PR title", () => {
    const refs = extractIssueRefs("Update handling for #77");
    expect(refs).toContain(77);
  });

  it("extracts multiple issue refs from text", () => {
    const refs = extractIssueRefs("Fixes #10, Closes #20, see #30");
    expect(refs).toContain(10);
    expect(refs).toContain(20);
    expect(refs).toContain(30);
  });

  it("extracts duplicate refs when keyword pattern matches multiple times", () => {
    const refs = extractIssueRefs("Fixes #42, also fixes #42");
    // The keyword pattern matches both "Fixes #42" occurrences, standalone #42 is deduped
    expect(refs.filter((n) => n === 42).length).toBeGreaterThanOrEqual(1);
  });
});

describe("cross-navigation: worktree → issue matching", () => {
  it("matches worktree branch to issue number", () => {
    const wt = makeWorktree({ branch: "42-add-login", name: "42-add-login" });
    const nums = extractIssueNumbers(wt.branch ?? wt.name);
    expect(nums).toContain(42);
  });

  it("matches worktree name when branch is null", () => {
    const wt = makeWorktree({ branch: null, name: "99-fix-bug" });
    const nums = extractIssueNumbers(wt.branch ?? wt.name);
    expect(nums).toContain(99);
  });
});

describe("cross-navigation: buildIssuePrMap integration", () => {
  it("builds complete map linking issues to PRs and branches", () => {
    const prMap = {
      "42-login": makePr({ number: 100, title: "Add login (#42)" }),
      "fix/99-crash": makePr({ number: 101, title: "Fix crash" }),
    };
    const branches = ["42-login", "fix/99-crash", "200-other"];
    const result = buildIssuePrMap(prMap, branches);

    // Issue 42 linked via branch name
    expect(result.get(42)?.pr.number).toBe(100);
    // Issue 99 linked via branch name
    expect(result.get(99)?.pr.number).toBe(101);
  });

  it("branch-name match takes priority over title ref for same issue", () => {
    const prMap = {
      "42-feature": makePr({ number: 1, title: "Fixes #42" }),
    };
    const result = buildIssuePrMap(prMap, []);
    // Branch name match processed first
    expect(result.get(42)?.branch).toBe("42-feature");
  });
});
