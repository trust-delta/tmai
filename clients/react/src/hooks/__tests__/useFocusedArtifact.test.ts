// @vitest-environment jsdom
//
// useFocusedArtifact — the R₂ "exactly one focused artifact" invariant.
// Focusing a PR or an issue clears the other, so the PR viewer and the issue
// viewer are never both mounted. (The decision/approach record viewer + the
// calibration + hand-over viewers retired with the decision/approach régime —
// rip ① / #554.)

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SelectedIssue } from "@/components/producer-console/r-panel/r-viewer/RIssueViewer";
import type { SelectedPr } from "@/components/producer-console/r-panel/r-viewer/RPrViewer";
import { useFocusedArtifact } from "@/hooks/useFocusedArtifact";

function prSelection(): SelectedPr {
  return {
    repoPath: "/p/u",
    repoLabel: "u",
    billingDead: false,
    pr: {
      number: 100n,
      title: "Add the thing",
      state: "OPEN",
      head_branch: "feat/x",
      head_sha: "abc1234",
      base_branch: "main",
      url: "https://github.com/o/r/pull/100",
      review_decision: "APPROVED",
      check_status: "SUCCESS",
      is_draft: false,
      additions: 10n,
      deletions: 1n,
      comments: 2n,
      reviews: 0n,
      author: "me",
      merge_commit_sha: null,
      created_at: null,
      merged_at: null,
      closed_at: null,
      ci_completed_at: null,
    },
  };
}

function issueSelection(): SelectedIssue {
  return {
    repoPath: "/p/u",
    repoLabel: "u",
    issue: {
      number: 7,
      title: "Fix the bug",
      state: "open",
      url: "https://github.com/o/r/issues/7",
      labels: [],
      assignees: [],
    },
  };
}

describe("useFocusedArtifact", () => {
  it("starts with nothing focused", () => {
    const { result } = renderHook(() => useFocusedArtifact());
    expect(result.current.selectedPr).toBeNull();
    expect(result.current.selectedIssue).toBeNull();
  });

  it("selecting an issue clears a selected PR (exactly one focus)", () => {
    const { result } = renderHook(() => useFocusedArtifact());

    act(() => result.current.selectPr(prSelection()));
    expect(result.current.selectedPr).not.toBeNull();
    expect(result.current.selectedIssue).toBeNull();

    act(() => result.current.selectIssue(issueSelection()));
    expect(result.current.selectedIssue).not.toBeNull();
    expect(result.current.selectedPr).toBeNull();
  });

  it("selecting a PR clears a selected issue (the reverse direction)", () => {
    const { result } = renderHook(() => useFocusedArtifact());

    act(() => result.current.selectIssue(issueSelection()));
    expect(result.current.selectedIssue).not.toBeNull();

    act(() => result.current.selectPr(prSelection()));
    expect(result.current.selectedPr).not.toBeNull();
    expect(result.current.selectedIssue).toBeNull();
  });

  it("clearPr / clearIssue clear only their own kind", () => {
    const { result } = renderHook(() => useFocusedArtifact());

    act(() => result.current.selectPr(prSelection()));
    act(() => result.current.clearPr());
    expect(result.current.selectedPr).toBeNull();

    act(() => result.current.selectIssue(issueSelection()));
    act(() => result.current.clearIssue());
    expect(result.current.selectedIssue).toBeNull();
  });

  it("clearAll clears both (used on a unit change)", () => {
    const { result } = renderHook(() => useFocusedArtifact());

    act(() => result.current.selectIssue(issueSelection()));
    act(() => result.current.clearAll());
    expect(result.current.selectedPr).toBeNull();
    expect(result.current.selectedIssue).toBeNull();
  });
});
