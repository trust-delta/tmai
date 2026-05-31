// @vitest-environment jsdom
//
// RDecisionsSection — header count fact, flat-chronological body
// (no temperature buckets), no severity styling.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DecisionsResponse, DecisionWire } from "@/lib/api";

const decisionsMock = vi.fn();

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      decisions: (...args: unknown[]) => decisionsMock(...args),
    },
  };
});

import { RDecisionsSection } from "../RDecisionsSection";
import { type SelectedRecord, selectedRecordKey } from "../r-viewer/RRecordViewer";

function decisionStub(overrides: Partial<DecisionWire> = {}): DecisionWire {
  return {
    slug: "2026-05-01-a",
    title: "Decision A",
    status: "accepted",
    category: "scoped",
    governs: [],
    last_verified: "2026-05-01",
    contract_surface: false,
    stale_since: null,
    superseded_by: [],
    strengthened_by: [],
    excerpt: "",
    ...overrides,
  };
}

function responseStub(overrides: Partial<DecisionsResponse> = {}): DecisionsResponse {
  return {
    unit: "u",
    composed_at: "2026-05-29T00:00:00Z",
    repos: [
      {
        repo_label: "u",
        repo_root: "/p/u",
        primary: true,
        repo_head: null,
        counts: {
          total: 0,
          in_play: 0,
          warm: 0,
          cold: 0,
          foundations: 0,
          superseded: 0,
          stale_suspect: 0,
        },
        currency_sweep: [],
        foundational_due: [],
        foundations: [],
        in_play: [],
        warm: [],
        cold: [],
        superseded: [],
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  decisionsMock.mockReset();
});

describe("RDecisionsSection", () => {
  it("collapsed by default; header click expands the body", async () => {
    decisionsMock.mockResolvedValue(responseStub());
    render(<RDecisionsSection unitName="u" expanded={false} onToggle={vi.fn()} />);
    expect(screen.getByTestId("r-section-decisions").getAttribute("data-expanded")).toBe("false");
  });

  it("flat-chronological ordering by last_verified desc (no temperature buckets)", async () => {
    decisionsMock.mockResolvedValue(
      responseStub({
        repos: [
          {
            ...responseStub().repos[0],
            in_play: [decisionStub({ slug: "old-d", title: "Old D", last_verified: "2026-01-01" })],
            foundations: [
              decisionStub({ slug: "mid-d", title: "Mid D", last_verified: "2026-03-15" }),
            ],
            warm: [decisionStub({ slug: "new-d", title: "New D", last_verified: "2026-05-20" })],
          },
        ],
      }),
    );

    render(<RDecisionsSection unitName="u" expanded={true} onToggle={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("New D")).toBeTruthy();
    });
    // Order check: New D before Mid D before Old D in the DOM.
    const all = screen.getAllByText(/\b(New|Mid|Old) D\b/);
    expect(all.map((n) => n.textContent)).toEqual(["New D", "Mid D", "Old D"]);
    // R is flat — no "Foundations" / "In play" / "Warm" / "Cold" bucket
    // headings (those are C's briefing layer).
    expect(screen.queryByText(/^Foundations$/)).toBeNull();
    expect(screen.queryByText(/^In play$/)).toBeNull();
    expect(screen.queryByText(/^Warm$/)).toBeNull();
    expect(screen.queryByText(/^Cold$/)).toBeNull();
  });

  it("count fact uses plain subtle styling (no severity)", async () => {
    decisionsMock.mockResolvedValue(
      responseStub({
        repos: [
          {
            ...responseStub().repos[0],
            in_play: [decisionStub()],
          },
        ],
      }),
    );

    const { container } = render(
      <RDecisionsSection unitName="u" expanded={false} onToggle={vi.fn()} />,
    );

    await waitFor(() => {
      expect(container.innerHTML).toMatch(/text-subtle-foreground/);
    });
    expect(container.innerHTML).not.toMatch(/text-warning|text-destructive|text-success/);
  });

  it("calls onToggle when the header is clicked", async () => {
    decisionsMock.mockResolvedValue(responseStub());
    const onToggle = vi.fn();
    render(<RDecisionsSection unitName="u" expanded={false} onToggle={onToggle} />);
    // The header button is on the Section primitive — fire on the
    // section's role=button.
    const header = screen.getByTestId("r-section-decisions").querySelector("button");
    expect(header).toBeTruthy();
    if (header) fireEvent.click(header);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("renders pick-a-project notice with null unit", () => {
    render(<RDecisionsSection unitName={null} expanded={true} onToggle={vi.fn()} />);
    expect(screen.getByText(/Pick a project/i)).toBeTruthy();
    expect(decisionsMock).not.toHaveBeenCalled();
  });

  // ── Inline drift marker (the R₁ "should I look?" attention signal) ──

  it("renders an inline drift marker for a decision with stale_since, none for a clean one", async () => {
    decisionsMock.mockResolvedValue(
      responseStub({
        repos: [
          {
            ...responseStub().repos[0],
            in_play: [
              decisionStub({
                slug: "drifted-d",
                title: "Drifted D",
                stale_since: {
                  path: "src/foo.rs",
                  change_date: "2026-05-20",
                  change_sha: "abc1234",
                  change_subject: "touch foo",
                },
              }),
            ],
            warm: [decisionStub({ slug: "clean-d", title: "Clean D", stale_since: null })],
          },
        ],
      }),
    );

    const { container } = render(
      <RDecisionsSection unitName="u" expanded={true} onToggle={vi.fn()} />,
    );

    // Drift marker present for the drifted decision.
    const drifted = await screen.findByRole("button", { name: /Drifted D/ });
    expect(drifted.textContent).toMatch(/drift/);
    // Absent for the clean one (silence-is-not-neutral: no "no drift" text).
    const clean = screen.getByRole("button", { name: /Clean D/ });
    expect(clean.textContent).not.toMatch(/drift/);
    // The marker is a plain fact, never a severity alarm.
    expect(container.innerHTML).not.toMatch(/text-warning|text-destructive|text-success/);
  });

  // ── R₂ selection wiring (mirrors RPrsSection's onSelectPr/aria-current) ──

  it("clicking a row calls onSelect with the decision wire object", async () => {
    decisionsMock.mockResolvedValue(
      responseStub({
        repos: [
          {
            ...responseStub().repos[0],
            in_play: [decisionStub({ slug: "2026-05-01-a", title: "Decision A" })],
          },
        ],
      }),
    );
    const onSelect = vi.fn();
    render(
      <RDecisionsSection unitName="u" expanded={true} onToggle={vi.fn()} onSelect={onSelect} />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Decision A/ }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    const arg = onSelect.mock.calls[0][0] as SelectedRecord;
    expect(arg.kind).toBe("decision");
    expect(arg.repoPath).toBe("/p/u");
    expect(arg.repoLabel).toBe("u");
    expect(arg.record.slug).toBe("2026-05-01-a");
  });

  it("marks the focused row with aria-current", async () => {
    decisionsMock.mockResolvedValue(
      responseStub({
        repos: [
          {
            ...responseStub().repos[0],
            in_play: [decisionStub({ slug: "2026-05-01-a", title: "Decision A" })],
          },
        ],
      }),
    );
    render(
      <RDecisionsSection
        unitName="u"
        expanded={true}
        onToggle={vi.fn()}
        onSelect={vi.fn()}
        selectedKey={selectedRecordKey("/p/u", "2026-05-01-a")}
      />,
    );

    const row = await screen.findByRole("button", { name: /Decision A/ });
    expect(row.getAttribute("aria-current")).toBe("true");
  });
});
