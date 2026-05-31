// @vitest-environment jsdom
//
// useFocusedArtifact — the R₂ "exactly one focused artifact" invariant.
// Focusing any one of a PR / record / issue / calibration / hand-over baton
// clears the other four, so the PR viewer, the record viewer, the issue
// viewer, the calibration viewer, and the hand-over viewer are never more
// than one mounted.

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SelectedCalibration } from "@/components/producer-console/r-panel/r-viewer/RCalibrationViewer";
import type { SelectedHandoff } from "@/components/producer-console/r-panel/r-viewer/RHandoverViewer";
import type { SelectedIssue } from "@/components/producer-console/r-panel/r-viewer/RIssueViewer";
import type { SelectedPr } from "@/components/producer-console/r-panel/r-viewer/RPrViewer";
import type { SelectedRecord } from "@/components/producer-console/r-panel/r-viewer/RRecordViewer";
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
    },
  };
}

function recordSelection(): SelectedRecord {
  return {
    kind: "decision",
    repoPath: "/p/u",
    repoLabel: "u",
    record: {
      slug: "2026-05-01-the-decision",
      title: "The Decision",
      status: "accepted",
      category: "principle",
      governs: [],
      last_verified: "2026-05-01",
      contract_surface: true,
      stale_since: null,
      superseded_by: [],
      strengthened_by: [],
      excerpt: "",
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

function calibrationSelection(): SelectedCalibration {
  return { unit: "u" };
}

function handoffSelection(): SelectedHandoff {
  return { unit: "u", name: "active" };
}

describe("useFocusedArtifact", () => {
  it("starts with nothing focused", () => {
    const { result } = renderHook(() => useFocusedArtifact());
    expect(result.current.selectedPr).toBeNull();
    expect(result.current.selectedRecord).toBeNull();
    expect(result.current.selectedIssue).toBeNull();
    expect(result.current.selectedCalibration).toBeNull();
    expect(result.current.selectedHandoff).toBeNull();
  });

  it("selecting a record clears a selected PR (exactly one focus)", () => {
    const { result } = renderHook(() => useFocusedArtifact());

    act(() => result.current.selectPr(prSelection()));
    expect(result.current.selectedPr).not.toBeNull();
    expect(result.current.selectedRecord).toBeNull();

    act(() => result.current.selectRecord(recordSelection()));
    expect(result.current.selectedRecord).not.toBeNull();
    expect(result.current.selectedPr).toBeNull();
  });

  it("selecting a PR clears a selected record (the reverse direction)", () => {
    const { result } = renderHook(() => useFocusedArtifact());

    act(() => result.current.selectRecord(recordSelection()));
    expect(result.current.selectedRecord).not.toBeNull();

    act(() => result.current.selectPr(prSelection()));
    expect(result.current.selectedPr).not.toBeNull();
    expect(result.current.selectedRecord).toBeNull();
  });

  it("selecting an issue clears BOTH a selected PR and record (exactly one focus across three)", () => {
    const { result } = renderHook(() => useFocusedArtifact());

    act(() => result.current.selectPr(prSelection()));
    act(() => result.current.selectIssue(issueSelection()));
    expect(result.current.selectedIssue).not.toBeNull();
    expect(result.current.selectedPr).toBeNull();
    expect(result.current.selectedRecord).toBeNull();

    // Re-arm from a record and confirm the same clear.
    act(() => result.current.selectRecord(recordSelection()));
    act(() => result.current.selectIssue(issueSelection()));
    expect(result.current.selectedIssue).not.toBeNull();
    expect(result.current.selectedRecord).toBeNull();
  });

  it("selecting a PR or a record clears a selected issue (the reverse direction)", () => {
    const { result } = renderHook(() => useFocusedArtifact());

    act(() => result.current.selectIssue(issueSelection()));
    act(() => result.current.selectPr(prSelection()));
    expect(result.current.selectedPr).not.toBeNull();
    expect(result.current.selectedIssue).toBeNull();

    act(() => result.current.selectIssue(issueSelection()));
    act(() => result.current.selectRecord(recordSelection()));
    expect(result.current.selectedRecord).not.toBeNull();
    expect(result.current.selectedIssue).toBeNull();
  });

  it("selecting calibration clears a PR, record, AND issue (exactly one focus across four)", () => {
    const { result } = renderHook(() => useFocusedArtifact());

    act(() => result.current.selectPr(prSelection()));
    act(() => result.current.selectRecord(recordSelection()));
    act(() => result.current.selectIssue(issueSelection()));
    act(() => result.current.selectCalibration(calibrationSelection()));
    expect(result.current.selectedCalibration).not.toBeNull();
    expect(result.current.selectedPr).toBeNull();
    expect(result.current.selectedRecord).toBeNull();
    expect(result.current.selectedIssue).toBeNull();
  });

  it("selecting a PR / record / issue each clears a selected calibration (the reverse direction)", () => {
    const { result } = renderHook(() => useFocusedArtifact());

    act(() => result.current.selectCalibration(calibrationSelection()));
    act(() => result.current.selectPr(prSelection()));
    expect(result.current.selectedPr).not.toBeNull();
    expect(result.current.selectedCalibration).toBeNull();

    act(() => result.current.selectCalibration(calibrationSelection()));
    act(() => result.current.selectRecord(recordSelection()));
    expect(result.current.selectedRecord).not.toBeNull();
    expect(result.current.selectedCalibration).toBeNull();

    act(() => result.current.selectCalibration(calibrationSelection()));
    act(() => result.current.selectIssue(issueSelection()));
    expect(result.current.selectedIssue).not.toBeNull();
    expect(result.current.selectedCalibration).toBeNull();
  });

  it("selecting a hand-over clears PR, record, issue, AND calibration (exactly one focus across five)", () => {
    const { result } = renderHook(() => useFocusedArtifact());

    act(() => result.current.selectPr(prSelection()));
    act(() => result.current.selectRecord(recordSelection()));
    act(() => result.current.selectIssue(issueSelection()));
    act(() => result.current.selectCalibration(calibrationSelection()));
    act(() => result.current.selectHandoff(handoffSelection()));
    expect(result.current.selectedHandoff).not.toBeNull();
    expect(result.current.selectedPr).toBeNull();
    expect(result.current.selectedRecord).toBeNull();
    expect(result.current.selectedIssue).toBeNull();
    expect(result.current.selectedCalibration).toBeNull();
  });

  it("selecting a PR / record / issue / calibration each clears a selected hand-over (the reverse direction)", () => {
    const { result } = renderHook(() => useFocusedArtifact());

    act(() => result.current.selectHandoff(handoffSelection()));
    act(() => result.current.selectPr(prSelection()));
    expect(result.current.selectedPr).not.toBeNull();
    expect(result.current.selectedHandoff).toBeNull();

    act(() => result.current.selectHandoff(handoffSelection()));
    act(() => result.current.selectRecord(recordSelection()));
    expect(result.current.selectedRecord).not.toBeNull();
    expect(result.current.selectedHandoff).toBeNull();

    act(() => result.current.selectHandoff(handoffSelection()));
    act(() => result.current.selectIssue(issueSelection()));
    expect(result.current.selectedIssue).not.toBeNull();
    expect(result.current.selectedHandoff).toBeNull();

    act(() => result.current.selectHandoff(handoffSelection()));
    act(() => result.current.selectCalibration(calibrationSelection()));
    expect(result.current.selectedCalibration).not.toBeNull();
    expect(result.current.selectedHandoff).toBeNull();
  });

  it("clearPr / clearRecord / clearIssue / clearCalibration / clearHandoff clear only their own kind", () => {
    const { result } = renderHook(() => useFocusedArtifact());

    act(() => result.current.selectPr(prSelection()));
    act(() => result.current.clearPr());
    expect(result.current.selectedPr).toBeNull();

    act(() => result.current.selectRecord(recordSelection()));
    act(() => result.current.clearRecord());
    expect(result.current.selectedRecord).toBeNull();

    act(() => result.current.selectIssue(issueSelection()));
    act(() => result.current.clearIssue());
    expect(result.current.selectedIssue).toBeNull();

    act(() => result.current.selectCalibration(calibrationSelection()));
    act(() => result.current.clearCalibration());
    expect(result.current.selectedCalibration).toBeNull();

    act(() => result.current.selectHandoff(handoffSelection()));
    act(() => result.current.clearHandoff());
    expect(result.current.selectedHandoff).toBeNull();
  });

  it("clearAll clears all five (used on a unit change)", () => {
    const { result } = renderHook(() => useFocusedArtifact());

    act(() => result.current.selectHandoff(handoffSelection()));
    act(() => result.current.clearAll());
    expect(result.current.selectedPr).toBeNull();
    expect(result.current.selectedRecord).toBeNull();
    expect(result.current.selectedIssue).toBeNull();
    expect(result.current.selectedCalibration).toBeNull();
    expect(result.current.selectedHandoff).toBeNull();
  });
});
