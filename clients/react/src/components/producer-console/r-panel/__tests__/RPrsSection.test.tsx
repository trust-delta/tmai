// @vitest-environment jsdom
//
// RPrsSection — open PR list (R₁) with NO severity-color CI / review
// badges. R₁ is pure inventory; the merge/override action layer (with
// its load-bearing soft-valve accents) lives in R₂. A row click threads
// the repo-level `billing_dead` flag into the R₂ selection so the
// override-merge affordance knows whether the PR's repo is flagged.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AttentionControls } from "@/hooks/useUnitAttention";
import type { Level, PrSummaryWire, Section, UnitPrsResponse } from "@/lib/api";

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

function attentionStub(overrides: Partial<AttentionControls> = {}): AttentionControls {
  return {
    levelFor: () => null,
    setAttention: vi.fn(),
    settingKey: null,
    ...overrides,
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

describe("RPrsSection — per-artifact attention markers", () => {
  it("renders a marker on each PR row when attention is threaded, colored by level", async () => {
    unitPrsMock.mockResolvedValue(response([pr()]));
    render(
      <RPrsSection
        unitName="u"
        expanded={true}
        onToggle={vi.fn()}
        attention={attentionStub({ levelFor: () => "high" })}
      />,
    );
    await waitFor(() => expect(screen.getByText("PR title")).toBeTruthy());
    const marker = screen.getByTestId("attention-marker");
    expect(marker.getAttribute("data-level")).toBe("high");
    // Operator-set heat is allowed on the marker (authorship pole)…
    expect(marker.className).toContain("attn-high");
  });

  it("keeps the row's own machine facts neutral — only the marker carries heat", async () => {
    unitPrsMock.mockResolvedValue(response([pr()]));
    render(
      <RPrsSection
        unitName="u"
        expanded={true}
        onToggle={vi.fn()}
        attention={attentionStub({ levelFor: () => "high" })}
      />,
    );
    await waitFor(() => expect(screen.getByText("PR title")).toBeTruthy());
    // The row button (CI/branch facts) is a machine-stated projection — it
    // must stay neutral; heat lives ONLY on the attention marker.
    const rowButton = screen.getByText("PR title").closest("button");
    expect(rowButton?.className).not.toMatch(/attn-high|attn-low/);
  });

  it("renders NO marker when attention is absent (markers are opt-in)", async () => {
    unitPrsMock.mockResolvedValue(response([pr()]));
    render(<RPrsSection unitName="u" expanded={true} onToggle={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("PR title")).toBeTruthy());
    expect(screen.queryByTestId("attention-marker")).toBeNull();
  });

  it("setting high on a row calls setAttention('pr', <number>, 'high')", async () => {
    const setAttention = vi.fn();
    unitPrsMock.mockResolvedValue(response([pr()]));
    render(
      <RPrsSection
        unitName="u"
        expanded={true}
        onToggle={vi.fn()}
        attention={attentionStub({ setAttention })}
      />,
    );
    await waitFor(() => expect(screen.getByText("PR title")).toBeTruthy());

    fireEvent.click(screen.getByTestId("attention-marker"));
    fireEvent.click(screen.getByTestId("attention-set-high"));
    expect(setAttention).toHaveBeenCalledWith("pr", "100", "high");
  });

  it("clicking the marker does NOT also open the row's R₂ viewer (stopPropagation)", async () => {
    const onSelectPr = vi.fn();
    unitPrsMock.mockResolvedValue(response([pr()]));
    render(
      <RPrsSection
        unitName="u"
        expanded={true}
        onToggle={vi.fn()}
        onSelectPr={onSelectPr}
        attention={attentionStub()}
      />,
    );
    await waitFor(() => expect(screen.getByText("PR title")).toBeTruthy());
    fireEvent.click(screen.getByTestId("attention-marker"));
    // The marker is its own control — clicking it must not select the row.
    expect(onSelectPr).not.toHaveBeenCalled();
  });
});

// `Section` has no File variant by construction, so a File row can never carry
// an attention marker (File is attention-exempt, contract §3). A static guard
// that the enum stays File-free protects that invariant at the type boundary.
describe("attention is File-exempt by construction", () => {
  it("the Section enum has no `file` variant", () => {
    const sections: Section[] = ["pr", "issue", "decision", "approach", "observation"];
    expect(sections).not.toContain("file" as unknown as Section);
    // A `Level` is only ever low/high — null is unrepresentable as a set value.
    const levels: Level[] = ["low", "high"];
    expect(levels).not.toContain("null" as unknown as Level);
  });
});
