// remote-delta — pure helpers for the remote-Δ freshness instrument (#822;
// design: tmai-core docs/archive/slack/2026-06-12-161334.md §3).
//
// Pinned exclusions (operator-ratified): the cursor is CLIENT STATE ONLY —
// it is never sent to any endpoint and the Producer never reads it; there
// is no per-row read-marking and no mute affordance; the cross-unit tab
// accent is deferred until a second unit exists. `advanceCursor` is the
// single mutation door and only the two close acts (panel collapse /
// section collapse) call it.

import { describe, expect, it } from "vitest";
import type { IssueSummaryWire, PrSummaryWire, RepoIssuesWire, RepoPrsWire } from "@/lib/api";
import {
  advanceCursor,
  effectiveCursor,
  issueVocabTimestamp,
  isUnobserved,
  prVocabTimestamp,
  unobservedIssueCount,
  unobservedPrCount,
} from "../remote-delta";

function pr(overrides: Partial<PrSummaryWire> = {}): PrSummaryWire {
  return {
    number: 100n,
    title: "PR title",
    state: "OPEN",
    head_branch: "feat/x",
    head_sha: "abc1234",
    base_branch: "main",
    url: "https://github.com/o/r/pull/100",
    review_decision: null,
    check_status: null,
    is_draft: false,
    additions: 10n,
    deletions: 1n,
    comments: 0n,
    reviews: 0n,
    author: "me",
    merge_commit_sha: null,
    created_at: null,
    merged_at: null,
    closed_at: null,
    ci_completed_at: null,
    last_synced_at: null,
    ...overrides,
  };
}

function issue(overrides: Partial<IssueSummaryWire> = {}): IssueSummaryWire {
  return {
    number: 1n,
    title: "Issue 1",
    state: "open",
    url: "https://github.com/o/r/issues/1",
    labels: [],
    assignees: [],
    created_at: null,
    closed_at: null,
    last_synced_at: null,
    ...overrides,
  };
}

describe("effectiveCursor — MAX(panel, section)", () => {
  it("returns null when the unit has no cursor at all (first run)", () => {
    expect(effectiveCursor({}, "u", "prs")).toBeNull();
  });

  it("returns the panel cursor when only the panel was closed", () => {
    const cursors = { u: { panel: "2026-06-13T10:00:00Z" } };
    expect(effectiveCursor(cursors, "u", "prs")).toBe("2026-06-13T10:00:00Z");
    expect(effectiveCursor(cursors, "u", "issues")).toBe("2026-06-13T10:00:00Z");
  });

  it("returns the section cursor when it is newer than the panel cursor", () => {
    const cursors = {
      u: { panel: "2026-06-13T10:00:00Z", prs: "2026-06-13T12:00:00Z" },
    };
    expect(effectiveCursor(cursors, "u", "prs")).toBe("2026-06-13T12:00:00Z");
    // The issues section has no own cursor → the panel close still covers it.
    expect(effectiveCursor(cursors, "u", "issues")).toBe("2026-06-13T10:00:00Z");
  });

  it("returns the panel cursor when it is newer than the section cursor", () => {
    const cursors = {
      u: { panel: "2026-06-13T12:00:00Z", prs: "2026-06-13T10:00:00Z" },
    };
    expect(effectiveCursor(cursors, "u", "prs")).toBe("2026-06-13T12:00:00Z");
  });

  it("is per-unit — another unit's cursor never leaks", () => {
    const cursors = { other: { panel: "2026-06-13T10:00:00Z" } };
    expect(effectiveCursor(cursors, "u", "prs")).toBeNull();
  });
});

describe("vocab timestamps — max of the row's non-null vocab events", () => {
  it("PR vocab = max(created, merged, closed, ci_completed)", () => {
    expect(
      prVocabTimestamp(
        pr({
          created_at: "2026-06-10T00:00:00Z",
          merged_at: "2026-06-12T00:00:00Z",
          closed_at: "2026-06-12T00:00:01Z",
          ci_completed_at: "2026-06-11T00:00:00Z",
        }),
      ),
    ).toBe("2026-06-12T00:00:01Z");
  });

  it("ignores null fields and returns the remaining max", () => {
    expect(prVocabTimestamp(pr({ created_at: "2026-06-10T00:00:00Z" }))).toBe(
      "2026-06-10T00:00:00Z",
    );
  });

  it("returns null when a row carries no vocab timestamps (older payload)", () => {
    expect(prVocabTimestamp(pr())).toBeNull();
    expect(issueVocabTimestamp(issue())).toBeNull();
  });

  it("issue vocab = max(created, closed)", () => {
    expect(
      issueVocabTimestamp(
        issue({ created_at: "2026-06-10T00:00:00Z", closed_at: "2026-06-12T00:00:00Z" }),
      ),
    ).toBe("2026-06-12T00:00:00Z");
  });
});

describe("isUnobserved", () => {
  it("first run (no cursor) → every row is unobserved, even without vocab ts", () => {
    // Honest 「一度も見ていない」 — self-clears on the first collapse act.
    expect(isUnobserved("2026-06-13T00:00:00Z", null)).toBe(true);
    expect(isUnobserved(null, null)).toBe(true);
  });

  it("vocab ts strictly newer than the cursor → unobserved", () => {
    expect(isUnobserved("2026-06-13T00:00:01Z", "2026-06-13T00:00:00Z")).toBe(true);
  });

  it("vocab ts at or before the cursor → observed", () => {
    expect(isUnobserved("2026-06-13T00:00:00Z", "2026-06-13T00:00:00Z")).toBe(false);
    expect(isUnobserved("2026-06-12T00:00:00Z", "2026-06-13T00:00:00Z")).toBe(false);
  });

  it("a row without vocab timestamps can never claim to be newer than a cursor", () => {
    expect(isUnobserved(null, "2026-06-13T00:00:00Z")).toBe(false);
  });
});

describe("advanceCursor — the single mutation door for the two close acts", () => {
  it("stamps the panel cursor for a unit, immutably", () => {
    const before = {};
    const after = advanceCursor(before, "u", "panel", "2026-06-13T10:00:00Z");
    expect(after).toEqual({ u: { panel: "2026-06-13T10:00:00Z" } });
    expect(before).toEqual({});
  });

  it("stamps a section cursor without disturbing the unit's other keys", () => {
    const before = { u: { panel: "2026-06-13T10:00:00Z" } };
    const after = advanceCursor(before, "u", "prs", "2026-06-13T11:00:00Z");
    expect(after.u).toEqual({ panel: "2026-06-13T10:00:00Z", prs: "2026-06-13T11:00:00Z" });
  });

  it("keeps other units' cursors intact (counts and cursors are within-unit)", () => {
    const before = { other: { issues: "2026-06-01T00:00:00Z" } };
    const after = advanceCursor(before, "u", "issues", "2026-06-13T10:00:00Z");
    expect(after.other).toEqual({ issues: "2026-06-01T00:00:00Z" });
  });
});

describe("unobserved counts (within-unit only)", () => {
  const cursor = "2026-06-13T00:00:00Z";

  it("counts unobserved PR rows across repos", () => {
    const repos: RepoPrsWire[] = [
      {
        repo_path: "/p/a",
        repo_label: "a",
        primary: true,
        prs: [
          pr({ number: 1n, created_at: "2026-06-13T01:00:00Z" }), // unobserved
          pr({ number: 2n, created_at: "2026-06-12T00:00:00Z" }), // observed
        ],
      },
      {
        repo_path: "/p/b",
        repo_label: "b",
        primary: false,
        prs: [pr({ number: 3n, merged_at: "2026-06-13T02:00:00Z" })], // unobserved
      },
    ];
    expect(unobservedPrCount(repos, cursor)).toBe(2);
    // First run: every row counts.
    expect(unobservedPrCount(repos, null)).toBe(3);
    expect(unobservedPrCount(null, cursor)).toBe(0);
  });

  it("counts unobserved issue rows across repos", () => {
    const repos: RepoIssuesWire[] = [
      {
        repo_path: "/p/a",
        repo_label: "a",
        primary: true,
        issues: [
          issue({ number: 1n, created_at: "2026-06-13T01:00:00Z" }), // unobserved
          issue({ number: 2n, created_at: "2026-06-12T00:00:00Z" }), // observed
        ],
      },
    ];
    expect(unobservedIssueCount(repos, cursor)).toBe(1);
    expect(unobservedIssueCount(repos, null)).toBe(2);
    expect(unobservedIssueCount(null, cursor)).toBe(0);
  });
});
