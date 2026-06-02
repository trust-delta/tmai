// @vitest-environment jsdom
//
// RInventorySection — cross-record in-play inventory (R₁), fed by
// `useUnitInventory` → `api.unitInventory`. Each decision is a row with its
// serving approaches nested under it, plus a trailing unanchored-approaches
// subsection. R₁ is a lens, not a dashboard: every projection fact
// (`stalled` / `overflow` / `orphaned` / residual-count) renders as plain
// neutral text — no severity-color badges. A row click opens the record in
// the R₂ `RRecordViewer`, so the section resolves each entry's slug (the
// projection carries only slug/display) against the unit's decisions +
// approaches — hence the three mocked endpoints.

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ApproachesResponse,
  ApproachInventoryWire,
  ApproachWire,
  DecisionInventoryWire,
  DecisionsResponse,
  DecisionWire,
  UnitInventoryResponse,
} from "@/lib/api";

const unitInventoryMock = vi.fn();
const decisionsMock = vi.fn();
const approachesMock = vi.fn();

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      unitInventory: (...args: unknown[]) => unitInventoryMock(...args),
      decisions: (...args: unknown[]) => decisionsMock(...args),
      approaches: (...args: unknown[]) => approachesMock(...args),
    },
  };
});

import { RInventorySection } from "../RInventorySection";

// ── Inventory projection fixtures (slug/display only — the wire shape) ──

function approachEntry(overrides: Partial<ApproachInventoryWire> = {}): ApproachInventoryWire {
  return {
    slug: "2026-02-01-an-approach",
    display: "an-approach",
    projected_status: "running",
    work_residual: { outstanding: [], count: 0 },
    liveness: { stalled: false, last_fact: "2026-06-01", days_since: 2n },
    ...overrides,
  };
}

function decisionEntry(overrides: Partial<DecisionInventoryWire> = {}): DecisionInventoryWire {
  return {
    slug: "2026-01-01-a-decision",
    display: "a-decision",
    frontmatter_status: "accepted",
    serving_health: "healthy",
    running_count: 1,
    serving: [],
    ...overrides,
  };
}

function inventory(overrides: Partial<UnitInventoryResponse> = {}): UnitInventoryResponse {
  return {
    unit: "u",
    today: "2026-06-03",
    decision_count: 0,
    approach_count: 0,
    decisions: [],
    unanchored_approaches: [],
    ...overrides,
  };
}

// ── Full-record fixtures (for slug → record resolution on a row click) ──

function decisionWire(slug: string): DecisionWire {
  return {
    slug,
    title: `Decision ${slug}`,
    status: "accepted",
    category: "scoped",
    governs: [],
    last_verified: "2026-06-01",
    contract_surface: false,
    stale_since: null,
    superseded_by: [],
    strengthened_by: [],
    excerpt: "",
  };
}

function decisionsResponse(slugs: string[]): DecisionsResponse {
  return {
    unit: "u",
    composed_at: "2026-06-03T00:00:00Z",
    repos: [
      {
        repo_label: "tmai",
        repo_root: "/p/tmai",
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
        in_play: slugs.map(decisionWire),
        warm: [],
        cold: [],
        superseded: [],
      },
    ],
  };
}

function approachWire(slug: string): ApproachWire {
  return {
    slug,
    title: `Approach ${slug}`,
    date: "2026-02-01",
    status: "running",
    governs: [],
    serves: [],
    success_signal: "",
    failure_signal: "",
    review_triggers: [],
    review_history: [],
    confidence: null,
    replaced_by: [],
    excerpt: "",
  };
}

function approachesResponse(slugs: string[]): ApproachesResponse {
  return {
    unit: "u",
    composed_at: "2026-06-03T00:00:00Z",
    repos: [
      {
        repo_label: "tmai",
        repo_root: "/p/tmai",
        primary: true,
        repo_head: null,
        approaches: slugs.map(approachWire),
      },
    ],
  };
}

beforeEach(() => {
  unitInventoryMock.mockReset();
  decisionsMock.mockReset();
  approachesMock.mockReset();
  // Default the resolution sources to empty so the section never reads an
  // undefined response; focus tests override these with matching slugs.
  decisionsMock.mockResolvedValue(decisionsResponse([]));
  approachesMock.mockResolvedValue(approachesResponse([]));
});

describe("RInventorySection", () => {
  it("renders each decision with its serving approaches nested under it", async () => {
    unitInventoryMock.mockResolvedValue(
      inventory({
        decision_count: 1,
        approach_count: 1,
        decisions: [
          decisionEntry({
            slug: "2026-01-01-a-decision",
            display: "a-decision",
            serving: [approachEntry({ slug: "2026-02-01-an-approach", display: "an-approach" })],
          }),
        ],
      }),
    );
    render(<RInventorySection unitName="u" expanded={true} onToggle={vi.fn()} />);
    const block = await screen.findByTestId("r-inventory-decision");
    // The decision display and its serving approach both live in the block.
    expect(within(block).getByText("a-decision")).toBeTruthy();
    expect(within(block).getByText("an-approach")).toBeTruthy();
  });

  it("renders a trailing unanchored-approaches subsection", async () => {
    unitInventoryMock.mockResolvedValue(
      inventory({
        approach_count: 1,
        unanchored_approaches: [
          approachEntry({ slug: "2026-02-02-loose-approach", display: "loose-approach" }),
        ],
      }),
    );
    render(<RInventorySection unitName="u" expanded={true} onToggle={vi.fn()} />);
    const unanchored = await screen.findByTestId("r-inventory-unanchored");
    expect(within(unanchored).getByText(/Unanchored approaches/i)).toBeTruthy();
    expect(within(unanchored).getByText("loose-approach")).toBeTruthy();
  });

  it("header count is the wire's own decision/approach counts", async () => {
    unitInventoryMock.mockResolvedValue(
      inventory({
        decision_count: 4,
        approach_count: 7,
        decisions: [decisionEntry()],
      }),
    );
    render(<RInventorySection unitName="u" expanded={true} onToggle={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText(/4 decisions · 7 approaches/)).toBeTruthy();
    });
  });

  it("renders stalled / overflow / orphaned as plain neutral facts (no severity color)", async () => {
    unitInventoryMock.mockResolvedValue(
      inventory({
        decision_count: 2,
        approach_count: 1,
        decisions: [
          decisionEntry({
            slug: "2026-01-01-overflowing",
            display: "overflowing",
            serving_health: "overflow",
            running_count: 3,
            serving: [
              approachEntry({
                slug: "2026-02-01-stale-approach",
                display: "stale-approach",
                work_residual: { outstanding: ["#42", "#43"], count: 2 },
                liveness: { stalled: true, last_fact: "2026-04-01", days_since: 63n },
              }),
            ],
          }),
          decisionEntry({
            slug: "2026-01-02-orphan",
            display: "orphan",
            serving_health: "orphaned",
            running_count: 0,
            serving: [],
          }),
        ],
      }),
    );
    const { container } = render(
      <RInventorySection unitName="u" expanded={true} onToggle={vi.fn()} />,
    );
    await screen.findByText("overflowing");
    // The mechanical projection labels are present as plain text…
    const text = container.textContent ?? "";
    expect(text).toContain("overflow");
    expect(text).toContain("orphaned");
    expect(text).toContain("stalled");
    expect(text).toContain("2 outstanding");
    expect(text).toContain("#42, #43");
    // …and NO severity-color classes appear anywhere.
    expect(container.innerHTML).not.toMatch(/text-warning|text-destructive|text-success/);
  });

  it("clicking a decision row opens it in R₂ with the resolved full record", async () => {
    decisionsMock.mockResolvedValue(decisionsResponse(["2026-01-01-a-decision"]));
    unitInventoryMock.mockResolvedValue(
      inventory({
        decision_count: 1,
        decisions: [decisionEntry({ slug: "2026-01-01-a-decision", display: "a-decision" })],
      }),
    );
    const onSelect = vi.fn();
    render(
      <RInventorySection unitName="u" expanded={true} onToggle={vi.fn()} onSelect={onSelect} />,
    );
    // Click within waitFor so the click lands once the slug→record index has
    // resolved (decisions/approaches are separate polls from the inventory).
    await waitFor(() => {
      fireEvent.click(screen.getByText("a-decision"));
      expect(onSelect).toHaveBeenCalled();
    });
    const sel = onSelect.mock.calls[0][0];
    expect(sel.kind).toBe("decision");
    expect(sel.repoPath).toBe("/p/tmai");
    expect(sel.repoLabel).toBe("tmai");
    expect(sel.record.slug).toBe("2026-01-01-a-decision");
  });

  it("clicking a nested serving approach opens it in R₂ with the resolved full record", async () => {
    approachesMock.mockResolvedValue(approachesResponse(["2026-02-01-an-approach"]));
    unitInventoryMock.mockResolvedValue(
      inventory({
        decision_count: 1,
        approach_count: 1,
        decisions: [
          decisionEntry({
            slug: "2026-01-01-a-decision",
            display: "a-decision",
            serving: [approachEntry({ slug: "2026-02-01-an-approach", display: "an-approach" })],
          }),
        ],
      }),
    );
    const onSelect = vi.fn();
    render(
      <RInventorySection unitName="u" expanded={true} onToggle={vi.fn()} onSelect={onSelect} />,
    );
    await waitFor(() => {
      fireEvent.click(screen.getByText("an-approach"));
      expect(onSelect).toHaveBeenCalled();
    });
    const sel = onSelect.mock.calls[0][0];
    expect(sel.kind).toBe("approach");
    expect(sel.repoPath).toBe("/p/tmai");
    expect(sel.record.slug).toBe("2026-02-01-an-approach");
  });

  it("marks the focused row with aria-current (and no others)", async () => {
    decisionsMock.mockResolvedValue(decisionsResponse(["2026-01-01-a-decision"]));
    unitInventoryMock.mockResolvedValue(
      inventory({
        decision_count: 1,
        decisions: [
          decisionEntry({ slug: "2026-01-01-a-decision", display: "a-decision" }),
          decisionEntry({ slug: "2026-01-02-other", display: "other" }),
        ],
      }),
    );
    render(
      <RInventorySection
        unitName="u"
        expanded={true}
        onToggle={vi.fn()}
        selectedKey="/p/tmai#2026-01-01-a-decision"
      />,
    );
    await waitFor(() => {
      const row = screen.getByText("a-decision").closest("button");
      expect(row?.getAttribute("aria-current")).toBe("true");
    });
    const other = screen.getByText("other").closest("button");
    expect(other?.getAttribute("aria-current")).toBeNull();
  });

  it("empty state — no in-play records", async () => {
    unitInventoryMock.mockResolvedValue(inventory());
    render(<RInventorySection unitName="u" expanded={true} onToggle={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText(/No in-play records/i)).toBeTruthy();
    });
  });

  it("prompts to pick a project when no unit is selected", () => {
    render(<RInventorySection unitName={null} expanded={true} onToggle={vi.fn()} />);
    expect(screen.getByText(/Pick a project/i)).toBeTruthy();
    expect(unitInventoryMock).not.toHaveBeenCalled();
  });
});
