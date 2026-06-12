// @vitest-environment jsdom
//
// RPrsSection — open PR list (R₁) with colour-coded lifecycle / review /
// CI status pills (C2, Stage C). Those pill colours are CATEGORICAL (which
// state), NOT severity appraisal — see `status-pills.tsx`. A row click
// threads the repo-level `billing_dead` flag into the R₂ selection so the
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

  it("keeps the operator attention-heat OFF the row button (orthogonal to status pills)", async () => {
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
    // Operator-authored attention heat (`attn-high`/`attn-low`) is a
    // separate axis from the C2 categorical status pills — it lives ONLY on
    // the attention marker, never on the row button.
    const rowButton = screen.getByText("PR title").closest("button");
    expect(rowButton?.className).not.toMatch(/attn-high|attn-low/);
  });

  it("renders NO marker when attention is absent (markers are opt-in)", async () => {
    unitPrsMock.mockResolvedValue(response([pr()]));
    render(<RPrsSection unitName="u" expanded={true} onToggle={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("PR title")).toBeTruthy());
    expect(screen.queryByTestId("attention-marker")).toBeNull();
  });

  it("setting high on a row calls setAttention(<repoPath>, 'pr', <number>, 'high')", async () => {
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
    // The marker threads its row's owning repo (`RepoPrsWire.repo_path`, here
    // `/p/u`) so two same-numbered PRs in different repos stay independent.
    expect(setAttention).toHaveBeenCalledWith("/p/u", "pr", "100", "high");
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
// an attention marker (File is attention-exempt, contract §3). These are
// COMPILE-TIME exact-union assertions, not runtime containment checks: a
// `Record<Section, true>` literal must name every member, so adding a variant
// (e.g. `file`) drops a required key and FAILS THE BUILD, and naming one the
// union lacks is an excess-property error. The boundary itself is the test —
// no `as unknown as` escape hatches (rules/typescript.md).
describe("attention is File-exempt by construction", () => {
  it("Section is exactly {pr, issue, decision, approach, observation} — no file", () => {
    const sectionMembers: Record<Section, true> = {
      pr: true,
      issue: true,
      decision: true,
      approach: true,
      observation: true,
    };
    expect(Object.keys(sectionMembers).sort()).toEqual([
      "approach",
      "decision",
      "issue",
      "observation",
      "pr",
    ]);
  });

  it("Level is exactly {low, high} — null is never a settable value", () => {
    const levelMembers: Record<Level, true> = { low: true, high: true };
    expect(Object.keys(levelMembers).sort()).toEqual(["high", "low"]);
  });
});
