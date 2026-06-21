// @vitest-environment jsdom
//
// RPrsSection — open PR list (R₁) with colour-coded lifecycle / review /
// CI status pills (C2, Stage C). Those pill colours are CATEGORICAL (which
// state), NOT severity appraisal — see `status-pills.tsx`. A row click
// threads the repo-level `billing_dead` flag into the R₂ selection so the
// override-merge affordance knows whether the PR's repo is flagged.

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
    created_at: null,
    merged_at: null,
    closed_at: null,
    ci_completed_at: null,
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
  it("renders colour-coded lifecycle / review / CI status pills (C2)", async () => {
    // Fixture pr() is OPEN + APPROVED + SUCCESS → open / approved / CI pass
    // pills, all categorical-`ok` (success) toned.
    unitPrsMock.mockResolvedValue(response([pr()]));
    render(<RPrsSection unitName="u" expanded={true} onToggle={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("PR title")).toBeTruthy();
    });
    expect(screen.getByText("open")).toBeTruthy();
    expect(screen.getByText("approved")).toBeTruthy();
    expect(screen.getByText("CI pass")).toBeTruthy();
    // Categorical colour IS allowed on these state pills (Stage C).
    for (const pill of screen.getAllByTestId("status-pill")) {
      expect(pill.getAttribute("data-tone")).toBe("ok");
    }
  });

  it("maps draft / changes-requested / CI-failure to the right pill tones", async () => {
    unitPrsMock.mockResolvedValue(
      response([
        pr({
          number: 200n,
          title: "draft PR",
          is_draft: true,
          review_decision: "CHANGES_REQUESTED",
          check_status: "FAILURE",
        }),
      ]),
    );
    render(<RPrsSection unitName="u" expanded={true} onToggle={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("draft PR")).toBeTruthy());
    const tones = screen.getAllByTestId("status-pill").map((p) => p.getAttribute("data-tone"));
    // draft → muted, changes requested → warn, CI fail → danger.
    expect(tones).toEqual(["muted", "warn", "danger"]);
    expect(screen.getByText("changes requested")).toBeTruthy();
    expect(screen.getByText("CI fail")).toBeTruthy();
  });

  it("renders the EXTERNAL · github framing badge on the section header", async () => {
    unitPrsMock.mockResolvedValue(response([pr()]));
    render(<RPrsSection unitName="u" expanded={true} onToggle={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("PR title")).toBeTruthy());
    expect(screen.getByTestId("external-source-badge")).toBeTruthy();
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

  it("clicking a PR row selects it for the R₂ viewer (billingDead defaults false)", async () => {
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
    // billing_dead absent on the wire ⇒ threaded as false.
    expect(sel.billingDead).toBe(false);
  });

  it("threads the repo-level billing_dead flag into the R₂ selection", async () => {
    const onSelectPr = vi.fn();
    unitPrsMock.mockResolvedValue({
      unit: "u",
      // billing-dead lives on the REPO, not the PR.
      repos: [
        { repo_path: "/p/u", repo_label: "u", primary: true, billing_dead: true, prs: [pr()] },
      ],
    });
    render(<RPrsSection unitName="u" expanded={true} onToggle={vi.fn()} onSelectPr={onSelectPr} />);
    await waitFor(() => {
      expect(screen.getByText("PR title")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("PR title"));
    expect(onSelectPr.mock.calls[0][0].billingDead).toBe(true);
  });
});

// ── Remote-Δ freshness (#822) ──
//
// A row is UNOBSERVED when its vocab timestamp (max of created / merged /
// closed / ci_completed) is strictly newer than the effective close-act
// cursor threaded in as `deltaCursor`. The accent is info-tone (cyan
// family) — a freshness FACT, never the warning/owed amber. No per-row
// read-marking, no mute affordance — the only acts are the two collapses
// (tested on RPanel).
describe("RPrsSection — remote-Δ freshness accents", () => {
  const CURSOR = "2026-06-12T00:00:00Z";

  it("accents rows newer than the cursor; observed rows render unchanged", async () => {
    unitPrsMock.mockResolvedValue(
      response([
        pr({ number: 101n, title: "new PR", created_at: "2026-06-13T00:00:00Z" }),
        pr({ number: 100n, title: "old PR", created_at: "2026-06-11T00:00:00Z" }),
      ]),
    );
    render(<RPrsSection unitName="u" expanded={true} onToggle={vi.fn()} deltaCursor={CURSOR} />);
    await waitFor(() => expect(screen.getByText("new PR")).toBeTruthy());

    const deltas = screen.getAllByTestId("unobserved-delta");
    expect(deltas).toHaveLength(1);
    // The Δ sits on the unobserved row…
    expect(screen.getByText("new PR").closest("button")?.textContent).toContain("Δ");
    // …and the observed row carries no counterpart element at all.
    expect(screen.getByText("old PR").closest("button")?.textContent).not.toContain("Δ");
    // Info-tone, never the warning amber (fact, not appraisal).
    expect(deltas[0].className).toContain("text-info");
    expect(deltas[0].className).not.toMatch(/warning/);
  });

  it("a state transition newer than the cursor accents the row (merged_at counts)", async () => {
    unitPrsMock.mockResolvedValue(
      response([
        pr({
          number: 100n,
          title: "merged PR",
          state: "MERGED",
          created_at: "2026-06-01T00:00:00Z",
          merged_at: "2026-06-13T00:00:00Z",
          closed_at: "2026-06-13T00:00:00Z",
        }),
      ]),
    );
    render(<RPrsSection unitName="u" expanded={true} onToggle={vi.fn()} deltaCursor={CURSOR} />);
    await waitFor(() => expect(screen.getByText("merged PR")).toBeTruthy());
    expect(screen.getAllByTestId("unobserved-delta")).toHaveLength(1);
  });

  it("first run (deltaCursor null) — every row is unobserved (一度も見ていない)", async () => {
    unitPrsMock.mockResolvedValue(
      response([
        pr({ number: 100n, created_at: "2020-01-01T00:00:00Z" }),
        // Even a row without vocab timestamps is unobserved on first run.
        pr({ number: 101n, title: "no-ts PR" }),
      ]),
    );
    render(<RPrsSection unitName="u" expanded={true} onToggle={vi.fn()} deltaCursor={null} />);
    await waitFor(() => expect(screen.getByText("PR title")).toBeTruthy());
    expect(screen.getAllByTestId("unobserved-delta")).toHaveLength(2);
  });

  it("renders NO accents when deltaCursor is absent (isolation / no wiring)", async () => {
    unitPrsMock.mockResolvedValue(response([pr({ created_at: "2026-06-13T00:00:00Z" })]));
    render(<RPrsSection unitName="u" expanded={true} onToggle={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("PR title")).toBeTruthy());
    expect(screen.queryByTestId("unobserved-delta")).toBeNull();
  });

  it("collapsed header shows the unobserved COUNT; expanded header does not", async () => {
    unitPrsMock.mockResolvedValue(
      response([
        pr({ number: 101n, created_at: "2026-06-13T00:00:00Z" }),
        pr({ number: 102n, ci_completed_at: "2026-06-13T01:00:00Z" }),
        pr({ number: 100n, created_at: "2026-06-11T00:00:00Z" }),
      ]),
    );
    const { rerender } = render(
      <RPrsSection unitName="u" expanded={false} onToggle={vi.fn()} deltaCursor={CURSOR} />,
    );
    await waitFor(() => expect(screen.getByText(/3 open/)).toBeTruthy());
    const badge = screen.getByTestId("r-section-unobserved-prs");
    expect(badge.textContent).toBe("Δ2");
    expect(badge.className).toContain("text-info");

    // Open section: the rows carry the accents, the header badge is gone.
    rerender(<RPrsSection unitName="u" expanded={true} onToggle={vi.fn()} deltaCursor={CURSOR} />);
    await waitFor(() => expect(screen.getAllByTestId("unobserved-delta")).toHaveLength(2));
    expect(screen.queryByTestId("r-section-unobserved-prs")).toBeNull();
  });

  it("no badge when the section is collapsed but everything is observed", async () => {
    unitPrsMock.mockResolvedValue(response([pr({ created_at: "2026-06-11T00:00:00Z" })]));
    render(<RPrsSection unitName="u" expanded={false} onToggle={vi.fn()} deltaCursor={CURSOR} />);
    await waitFor(() => expect(screen.getByText(/1 open/)).toBeTruthy());
    expect(screen.queryByTestId("r-section-unobserved-prs")).toBeNull();
  });
});

// Recently-transitioned rows (#822 scope 6): the unit list now includes
// merged/closed rows from the 7-day window — the section must render their
// lifecycle pills and keep the wire order (newest first by number) intact.
describe("RPrsSection — recently-transitioned rows", () => {
  it("renders a merged row's lifecycle pill and keeps wire order stable", async () => {
    unitPrsMock.mockResolvedValue(
      response([
        pr({ number: 102n, title: "open PR" }),
        pr({
          number: 101n,
          title: "merged PR",
          state: "MERGED",
          merged_at: "2026-06-12T00:00:00Z",
          closed_at: "2026-06-12T00:00:00Z",
          review_decision: null,
          check_status: null,
        }),
        pr({
          number: 100n,
          title: "closed PR",
          state: "CLOSED",
          closed_at: "2026-06-11T00:00:00Z",
          review_decision: null,
          check_status: null,
        }),
      ]),
    );
    const { container } = render(<RPrsSection unitName="u" expanded={true} onToggle={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("merged PR")).toBeTruthy());

    // Lifecycle pills for the non-open states.
    expect(screen.getByText("merged")).toBeTruthy();
    expect(screen.getByText("closed")).toBeTruthy();
    // Wire order preserved — newest first by number, no client-side re-sort.
    const rows = Array.from(container.querySelectorAll("li")).map((li) => li.textContent ?? "");
    expect(rows[0]).toContain("#102");
    expect(rows[1]).toContain("#101");
    expect(rows[2]).toContain("#100");
  });
});
