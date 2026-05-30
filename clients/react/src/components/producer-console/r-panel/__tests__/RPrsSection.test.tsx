// @vitest-environment jsdom
//
// RPrsSection — open PR list with NO severity-color CI / review
// badges. Negative-space check: the C-column UnitPrsSection uses
// text-warning/destructive/success classes for state; R intentionally
// does not.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrSummaryWire, UnitPrsResponse } from "@/lib/api";

const unitPrsMock = vi.fn();

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      unitPrs: (...args: unknown[]) => unitPrsMock(...args),
    },
  };
});

import { RPrsSection } from "../RPrsSection";

function pr(overrides: Partial<PrSummaryWire> = {}): PrSummaryWire {
  return {
    number: 100n,
    title: "PR title",
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
    comments: 0n,
    reviews: 0n,
    author: "me",
    merge_commit_sha: null,
    ...overrides,
  };
}

function response(prs: PrSummaryWire[] = []): UnitPrsResponse {
  return {
    unit: "u",
    repos: [{ repo_path: "/p/u", repo_label: "u", primary: true, prs }],
  };
}

beforeEach(() => {
  unitPrsMock.mockReset();
});

describe("RPrsSection", () => {
  it("renders open PRs with plain (no-severity) CI / review status text", async () => {
    unitPrsMock.mockResolvedValue(response([pr()]));
    const { container } = render(<RPrsSection unitName="u" expanded={true} onToggle={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("PR title")).toBeTruthy();
    });
    // Plain text: "CI SUCCESS · APPROVED" — no severity badge classes.
    expect(screen.getByText(/CI SUCCESS/)).toBeTruthy();
    expect(container.innerHTML).not.toMatch(/text-warning|text-destructive|text-success/);
  });

  it("header count shows `N open` from the wire (no aggregation)", async () => {
    unitPrsMock.mockResolvedValue(response([pr(), pr({ number: 101n })]));
    render(<RPrsSection unitName="u" expanded={false} onToggle={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText(/2 open/)).toBeTruthy();
    });
  });

  it("empty state — header shows `0 open`", async () => {
    unitPrsMock.mockResolvedValue(response([]));
    render(<RPrsSection unitName="u" expanded={true} onToggle={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText(/0 open/)).toBeTruthy();
    });
    expect(screen.getByText(/No open PRs/i)).toBeTruthy();
  });

  it("has NO github.com link-out — the row is an in-tmai select (#749)", async () => {
    unitPrsMock.mockResolvedValue(response([pr()]));
    const { container } = render(<RPrsSection unitName="u" expanded={true} onToggle={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("PR title")).toBeTruthy();
    });
    // The PR number used to be an <a href> to github.com; it is now a
    // button that opens the R₂ viewer in-tmai. No anchor should remain.
    expect(container.querySelector("a[href*='github.com']")).toBeNull();
  });

  it("clicking a PR row selects it for the R₂ viewer", async () => {
    const onSelectPr = vi.fn();
    unitPrsMock.mockResolvedValue(response([pr()]));
    render(<RPrsSection unitName="u" expanded={true} onToggle={vi.fn()} onSelectPr={onSelectPr} />);
    await waitFor(() => {
      expect(screen.getByText("PR title")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("PR title"));
    expect(onSelectPr).toHaveBeenCalledTimes(1);
    const sel = onSelectPr.mock.calls[0][0];
    expect(sel.repoPath).toBe("/p/u");
    expect(sel.pr.number).toBe(100n);
  });
});
