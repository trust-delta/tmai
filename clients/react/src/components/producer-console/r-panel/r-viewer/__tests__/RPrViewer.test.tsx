// @vitest-environment jsdom
//
// RPrViewer — the R₂ in-tmai PR content viewer (#749). The detail
// fetchers are mocked so this test proves: every section renders its
// fetched fact (body / labels / comments / merge-status / CI / diff),
// mechanical status facts stay PLAIN (no severity tint — viewer-approach
// negative space), there is NO github.com link-out, the close button
// fires, and the CI failure-log drill-down is operator-initiated.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrSummaryWire } from "@/lib/api";

const prBody = vi.fn();
const prLabels = vi.fn();
const getPrComments = vi.fn();
const getPrMergeStatus = vi.fn();
const prDiff = vi.fn();
const listChecks = vi.fn();
const getCiFailureLog = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    prBody: (...a: unknown[]) => prBody(...a),
    prLabels: (...a: unknown[]) => prLabels(...a),
    getPrComments: (...a: unknown[]) => getPrComments(...a),
    getPrMergeStatus: (...a: unknown[]) => getPrMergeStatus(...a),
    prDiff: (...a: unknown[]) => prDiff(...a),
    listChecks: (...a: unknown[]) => listChecks(...a),
    getCiFailureLog: (...a: unknown[]) => getCiFailureLog(...a),
  },
}));

import { RPrViewer, type SelectedPr } from "../RPrViewer";

function pr(overrides: Partial<PrSummaryWire> = {}): PrSummaryWire {
  return {
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
    ...overrides,
  };
}

function selected(overrides: Partial<PrSummaryWire> = {}): SelectedPr {
  return { repoPath: "/p/u", repoLabel: "u", pr: pr(overrides) };
}

beforeEach(() => {
  for (const m of [prBody, prLabels, getPrComments, getPrMergeStatus, prDiff, listChecks]) {
    m.mockReset();
  }
  getCiFailureLog.mockReset();
  // Default happy-path resolutions; individual tests override as needed.
  prBody.mockResolvedValue("## Body heading\n\nbody text");
  prLabels.mockResolvedValue(["enhancement", "webui"]);
  getPrComments.mockResolvedValue([
    {
      author: "coderabbitai",
      body: "nit: rename this",
      created_at: "2026-05-30T10:00:00Z",
      url: "https://github.com/o/r/pull/100#c1",
      comment_type: "review",
      path: "src/lib/api.ts",
      diff_hunk: "@@ -1,3 +1,3 @@\n-old\n+new",
    },
  ]);
  getPrMergeStatus.mockResolvedValue({
    mergeable: "MERGEABLE",
    merge_state_status: "CLEAN",
    review_decision: "APPROVED",
    check_status: "SUCCESS",
  });
  prDiff.mockResolvedValue({ repo: "/p/u", pr_number: 100n, patch: "" });
  listChecks.mockResolvedValue({ branch: "feat/x", checks: [], rollup: "SUCCESS" });
});

describe("RPrViewer", () => {
  it("renders header inventory facts for the selected PR", () => {
    render(<RPrViewer selected={selected()} onClose={vi.fn()} />);
    expect(screen.getByText("Add the thing")).toBeTruthy();
    expect(screen.getByText("#100")).toBeTruthy();
    expect(screen.getByText("feat/x → main")).toBeTruthy();
    expect(screen.getByText("@me")).toBeTruthy();
  });

  it("renders body, labels, comments, merge-status and CI from the fetchers", async () => {
    render(<RPrViewer selected={selected()} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Body heading")).toBeTruthy());
    expect(screen.getByText("enhancement")).toBeTruthy();
    expect(screen.getByText("webui")).toBeTruthy();
    expect(screen.getByText("@coderabbitai")).toBeTruthy();
    expect(screen.getByText("nit: rename this")).toBeTruthy();
    // Merge-status facts are plain.
    expect(screen.getByText("MERGEABLE")).toBeTruthy();
    expect(prBody).toHaveBeenCalledWith("/p/u", 100);
    expect(listChecks).toHaveBeenCalledWith("/p/u", "feat/x");
  });

  it("uses NO severity-color classes on status facts (negative-space)", async () => {
    // Empty diff → DiffViewer not mounted, so the only colours present
    // would be appraisal tints — there must be none.
    const { container } = render(<RPrViewer selected={selected()} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("MERGEABLE")).toBeTruthy());
    const html = container.innerHTML;
    expect(html).not.toMatch(/text-warning/);
    expect(html).not.toMatch(/text-destructive/);
    expect(html).not.toMatch(/text-success/);
  });

  it("has NO github.com link-out anywhere in the viewer (#749)", async () => {
    const { container } = render(<RPrViewer selected={selected()} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Body heading")).toBeTruthy());
    expect(container.querySelector("a[href*='github.com']")).toBeNull();
  });

  it("fires onClose from the close button", () => {
    const onClose = vi.fn();
    render(<RPrViewer selected={selected()} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /Close PR viewer/ }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("drills into a failed check's failure log only on operator click", async () => {
    listChecks.mockResolvedValue({
      branch: "feat/x",
      rollup: "FAILURE",
      checks: [
        {
          name: "build",
          status: "completed",
          conclusion: "failure",
          url: "https://github.com/o/r/runs/9",
          started_at: null,
          completed_at: null,
          run_id: 9,
        },
      ],
    });
    getCiFailureLog.mockResolvedValue({ run_id: 9, log_text: "error: boom on line 3" });
    render(<RPrViewer selected={selected()} onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("build")).toBeTruthy());
    // Not fetched until clicked.
    expect(getCiFailureLog).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /View failure log/ }));
    await waitFor(() => expect(screen.getByText(/boom on line 3/)).toBeTruthy());
    expect(getCiFailureLog).toHaveBeenCalledWith("/p/u", 9);
  });

  it("shows an empty-diff notice when head matches base", async () => {
    render(<RPrViewer selected={selected()} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Empty diff/)).toBeTruthy());
  });
});
