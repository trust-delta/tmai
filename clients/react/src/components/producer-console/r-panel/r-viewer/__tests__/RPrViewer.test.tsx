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
const mergePr = vi.fn();
const rerunFailedChecks = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    prBody: (...a: unknown[]) => prBody(...a),
    prLabels: (...a: unknown[]) => prLabels(...a),
    getPrComments: (...a: unknown[]) => getPrComments(...a),
    getPrMergeStatus: (...a: unknown[]) => getPrMergeStatus(...a),
    prDiff: (...a: unknown[]) => prDiff(...a),
    listChecks: (...a: unknown[]) => listChecks(...a),
    getCiFailureLog: (...a: unknown[]) => getCiFailureLog(...a),
    mergePr: (...a: unknown[]) => mergePr(...a),
    rerunFailedChecks: (...a: unknown[]) => rerunFailedChecks(...a),
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

function selected(overrides: Partial<PrSummaryWire> = {}, billingDead = false): SelectedPr {
  return { repoPath: "/p/u", repoLabel: "u", pr: pr(overrides), billingDead };
}

beforeEach(() => {
  for (const m of [prBody, prLabels, getPrComments, getPrMergeStatus, prDiff, listChecks]) {
    m.mockReset();
  }
  getCiFailureLog.mockReset();
  mergePr.mockReset();
  rerunFailedChecks.mockReset();
  mergePr.mockResolvedValue({ status: "merged" });
  rerunFailedChecks.mockResolvedValue({ status: "queued" });
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
    // The Actions footer (merge soft-valve / override) legitimately
    // carries success/warning/destructive accents — those are
    // affordances, not status facts. Exclude it; everything else (the
    // header + the fetched status sections) must stay plain.
    container.querySelector('[data-testid="r-pr-actions"]')?.remove();
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

  it("returns to the inventory via the ‹ Inventory back affordance (clears the focus)", () => {
    const onClose = vi.fn();
    render(<RPrViewer selected={selected()} onClose={onClose} />);
    // Focus mode: the close is a RETURN to the inventory, not a column
    // dismiss. It is still wired to `onClose`, which clears the focus.
    fireEvent.click(screen.getByRole("button", { name: /Back to inventory/ }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("fills the R region — carries no fixed clamp width (focus mode rides the R column)", () => {
    const { container } = render(<RPrViewer selected={selected()} onClose={vi.fn()} />);
    const root = container.querySelector('[data-testid="r-pr-viewer"]');
    expect(root).not.toBeNull();
    // No self-imposed width (the retired `w-[clamp(22rem,40vw,48rem)]`); it
    // fills the R panel column instead.
    expect(root?.className ?? "").not.toMatch(/w-\[/);
    expect(root?.className ?? "").toMatch(/flex-1/);
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

  // ── Action layer (spine `2026-05-29-c-and-r-as-the-development-
  // substrate` "🔀 PRs (iii)") — merge soft-valve + billing-dead override
  // + CI rerun, ported 1:1 from the retired C-column `UnitPrsSection`. ──

  // Stage-2 asymmetric-friction valve: the unlock is a *delivered-state
  // fact* (`producer_reviewed === true` — the Δ-brief reached the
  // operator), NOT a Producer approval. Not-delivered is friction +
  // visibility, never a block (§E boundary).

  it("merges a Δ-brief-delivered PR in one click (no confirm) and closes the viewer", async () => {
    const onClose = vi.fn();
    render(<RPrViewer selected={selected({ producer_reviewed: true })} onClose={onClose} />);

    fireEvent.click(await screen.findByRole("button", { name: /^Merge #100$/ }));
    // One click → merges directly; no arm/confirm step is ever shown.
    await waitFor(() =>
      expect(mergePr).toHaveBeenCalledWith("/p/u", 100, {
        method: "squash",
        deleteBranch: true,
      }),
    );
    expect(screen.queryByRole("button", { name: /Confirm/ })).toBeNull();
    // Merge-success closes R₂ so the now-merged PR isn't left stale.
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("keeps an un-briefed merge a dismissible 'not delivered' confirm, never a block", async () => {
    const onClose = vi.fn();
    render(<RPrViewer selected={selected()} onClose={onClose} />);

    const mergeBtn = await screen.findByRole("button", { name: /^Merge #100$/ });
    fireEvent.click(mergeBtn);
    // Arms friction (delivered/not-delivered wording), does not merge.
    expect(screen.getByText(/Producer review not delivered for this PR/)).toBeTruthy();
    expect(mergePr).not.toHaveBeenCalled();

    // Always dismissible.
    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/ }));
    await waitFor(() =>
      expect(screen.queryByText(/Producer review not delivered for this PR/)).toBeNull(),
    );

    // And the operator can ALWAYS go through (friction, not a gate).
    fireEvent.click(await screen.findByRole("button", { name: /^Merge #100$/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Confirm/ }));
    await waitFor(() => expect(mergePr).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  // Phase B billing-dead CI-safe override — a DISTINCT affordance, shown
  // ONLY when the repo is flagged billing-dead AND this PR's CI is red.

  const OVERRIDE_BTN = /Override \(ci-local attestation\)/;

  it("does not show the override button unless the repo is billing-dead AND CI is red", async () => {
    // CI red but not billing-dead.
    const { unmount } = render(
      <RPrViewer selected={selected({ check_status: "FAILURE" }, false)} onClose={vi.fn()} />,
    );
    await screen.findByText("Add the thing");
    expect(screen.queryByRole("button", { name: OVERRIDE_BTN })).toBeNull();
    unmount();

    // billing-dead but CI green.
    render(<RPrViewer selected={selected({ check_status: "SUCCESS" }, true)} onClose={vi.fn()} />);
    await screen.findByText("Add the thing");
    expect(screen.queryByRole("button", { name: OVERRIDE_BTN })).toBeNull();
  });

  it("shows the override button only when billing-dead AND CI red, and confirms with the exact payload", async () => {
    const onClose = vi.fn();
    render(<RPrViewer selected={selected({ check_status: "FAILURE" }, true)} onClose={onClose} />);

    fireEvent.click(await screen.findByRole("button", { name: OVERRIDE_BTN }));
    const textarea = screen.getByLabelText(/CI-local attestation/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "ci-local: all green\n42 passed" } });
    fireEvent.click(screen.getByRole("button", { name: /Override-merge #100/ }));

    await waitFor(() =>
      expect(mergePr).toHaveBeenCalledWith("/p/u", 100, {
        method: "squash",
        deleteBranch: true,
        override: {
          ci_local_attestation: "ci-local: all green\n42 passed",
          repo_billing_dead_acknowledged: true,
        },
      }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("pre-fills the override textarea from the Producer's ci-local attestation and disables Confirm when empty", async () => {
    // Prefilled → non-empty → Confirm enabled without typing.
    const { unmount } = render(
      <RPrViewer
        selected={selected(
          { check_status: "FAILURE", ci_local_attestation: "ci-local — PASS" },
          true,
        )}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: OVERRIDE_BTN }));
    expect((screen.getByLabelText(/CI-local attestation/i) as HTMLTextAreaElement).value).toBe(
      "ci-local — PASS",
    );
    expect(
      (screen.getByRole("button", { name: /Override-merge #100/ }) as HTMLButtonElement).disabled,
    ).toBe(false);
    unmount();

    // Absent → empty manual-paste fallback → Confirm disabled.
    render(<RPrViewer selected={selected({ check_status: "FAILURE" }, true)} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: OVERRIDE_BTN }));
    expect((screen.getByLabelText(/CI-local attestation/i) as HTMLTextAreaElement).value).toBe("");
    expect(
      (screen.getByRole("button", { name: /Override-merge #100/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("adopts a newer prefill while the textarea is clean but never clobbers an operator's edit", async () => {
    const sel = (att: string): SelectedPr =>
      selected({ check_status: "FAILURE", ci_local_attestation: att }, true);
    const { rerender } = render(<RPrViewer selected={sel("ci-local v1")} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: OVERRIDE_BTN }));
    const ta = () => screen.getByLabelText(/CI-local attestation/i) as HTMLTextAreaElement;
    expect(ta().value).toBe("ci-local v1");

    // Clean (un-edited) → a re-selection with a newer attestation adopts it.
    rerender(<RPrViewer selected={sel("ci-local v2 (newer)")} onClose={vi.fn()} />);
    expect(ta().value).toBe("ci-local v2 (newer)");

    // Operator edits → a later prefill change must NOT clobber the edit.
    fireEvent.change(ta(), { target: { value: "operator hand-edit" } });
    rerender(<RPrViewer selected={sel("ci-local v3")} onClose={vi.fn()} />);
    expect(ta().value).toBe("operator hand-edit");
  });

  // CI rerun — light/direct action keyed by a failed check's `run_id`
  // (the same field the failure-log drill-down uses), NOT by the PR.

  it("reruns a failed check via rerunFailedChecks keyed by its run_id", async () => {
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
    render(<RPrViewer selected={selected({ check_status: "FAILURE" })} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: /^CI rerun$/ }));
    await waitFor(() => expect(rerunFailedChecks).toHaveBeenCalledWith("/p/u", 9));
    // After it queues, the button reflects the queued state.
    await waitFor(() => expect(screen.getByRole("button", { name: /Rerun queued/ })).toBeTruthy());
  });

  it("offers no CI rerun on a passing check (no run to rerun)", async () => {
    listChecks.mockResolvedValue({
      branch: "feat/x",
      rollup: "SUCCESS",
      checks: [
        {
          name: "build",
          status: "completed",
          conclusion: "success",
          url: "https://github.com/o/r/runs/9",
          started_at: null,
          completed_at: null,
          run_id: 9,
        },
      ],
    });
    render(<RPrViewer selected={selected()} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("build")).toBeTruthy());
    expect(screen.queryByRole("button", { name: /CI rerun/ })).toBeNull();
    expect(rerunFailedChecks).not.toHaveBeenCalled();
  });
});
