// @vitest-environment jsdom
//
// RCalibrationViewer — the R₂ in-tmai Calibration overview viewer
// (per-unit, read-only). The polling `useCalibration` hook is mocked with
// SYNTHETIC fixtures so this test never touches real/live calibration data
// (calibration is the operator's judge-of-the-Producer surface — built and
// tested entirely from hand-made `CalibrationResponse` objects).
//
// It proves: header window facts render (unit / days / totals / tier-1
// routed); the bootstrap caveat shows only when under threshold; the
// `cells` aggregation renders as a plain table (counts + hit-rate);
// tier-1 violations + recent false-negatives render with full per-entry
// detail (note_source / verdict / confidence / tier_routed / rationale /
// recorded_at / outcome); NO severity classes appear anywhere (the
// load-bearing plain-everything rule — no red alarm even on tier-1); the
// viewer fills the R region (no `w-[` clamp, has `flex-1`); and the
// ‹ Inventory back affordance calls `onClose`.

import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
// Type-only import from the mocked hook module — erased at runtime, so it
// does not collide with the `vi.mock` factory below.
import type { UseCalibrationResult } from "@/hooks/useCalibration";
import type { CalibrationEntry, CalibrationResponse } from "@/lib/api";

const useCalibrationMock = vi.fn();

vi.mock("@/hooks/useCalibration", () => ({
  useCalibration: (...a: unknown[]) => useCalibrationMock(...a),
}));

import { RCalibrationViewer, type SelectedCalibration } from "../RCalibrationViewer";

// ── synthetic fixtures (NO real calibration data) ──

function entry(overrides: Partial<CalibrationEntry> = {}): CalibrationEntry {
  return {
    synthesis_pass_id: "pass-0001",
    note_source: "20260513-1500-baz.md",
    verdict: "absorb",
    confidence: "low",
    tier_routed: 2,
    rationale: "looked like a one-off nit, not a contract change",
    recorded_at: "2026-05-13T15:00:00Z",
    outcome: null,
    ...overrides,
  };
}

function response(overrides: Partial<CalibrationResponse> = {}): CalibrationResponse {
  return {
    unit: "tmai",
    days: 90,
    total_in_store: 42,
    total_in_window: 30,
    bootstrap_threshold: 10,
    cells: [
      { verdict: "absorb", confidence: "low", n: 8, hits: 6, misses: 2 },
      { verdict: "escalate", confidence: "high", n: 4, hits: 4, misses: 0 },
    ],
    tier1_routed: 2,
    tier1_violations: [
      entry({
        synthesis_pass_id: "pass-tier1",
        note_source: "20260512-0900-tripwire.md",
        verdict: "escalate",
        confidence: "high",
        tier_routed: 1,
        rationale: "named a contract surface — human gate",
        recorded_at: "2026-05-12T09:00:00Z",
        outcome: { kind: "revert_commit", commit_sha: "deadbeef", date: "2026-05-14" },
      }),
    ],
    recent_false_negatives: [
      entry({
        synthesis_pass_id: "pass-fn",
        note_source: "20260511-1200-missed.md",
        verdict: "absorb",
        confidence: "low",
        tier_routed: 2,
        rationale: "absorbed but the world later disagreed",
        recorded_at: "2026-05-11T12:00:00Z",
        outcome: { kind: "ci_fail_fix", failing_pr: 700, fix_pr: 701 },
      }),
    ],
    ...overrides,
  };
}

function result(overrides: Partial<UseCalibrationResult> = {}): UseCalibrationResult {
  return { data: response(), loading: false, error: null, ...overrides };
}

const selected: SelectedCalibration = { unit: "tmai" };

beforeEach(() => {
  useCalibrationMock.mockReset();
  useCalibrationMock.mockReturnValue(result());
});

describe("RCalibrationViewer", () => {
  it("fetches calibration for exactly the selected unit (selection-driven)", () => {
    render(<RCalibrationViewer selected={selected} onClose={vi.fn()} />);
    expect(useCalibrationMock).toHaveBeenCalledWith("tmai");
  });

  it("renders header window facts (unit / days / totals / tier-1 routed)", () => {
    render(<RCalibrationViewer selected={selected} onClose={vi.fn()} />);
    expect(screen.getByText(/tmai · calibration/)).toBeTruthy();
    expect(screen.getByText(/last 90 days/)).toBeTruthy();
    expect(screen.getByText(/30 in window/)).toBeTruthy();
    expect(screen.getByText(/42 in store/)).toBeTruthy();
    expect(screen.getByText(/2 tier-1 routed/)).toBeTruthy();
  });

  it("shows the bootstrap caveat only when total_in_window < bootstrap_threshold", () => {
    useCalibrationMock.mockReturnValue(
      result({ data: response({ total_in_window: 4, bootstrap_threshold: 10 }) }),
    );
    const { rerender } = render(<RCalibrationViewer selected={selected} onClose={vi.fn()} />);
    expect(screen.getByText(/lean toward asking the human/)).toBeTruthy();

    // At/over threshold the caveat is absent.
    useCalibrationMock.mockReturnValue(
      result({ data: response({ total_in_window: 30, bootstrap_threshold: 10 }) }),
    );
    rerender(<RCalibrationViewer selected={selected} onClose={vi.fn()} />);
    expect(screen.queryByText(/lean toward asking the human/)).toBeNull();
  });

  it("renders the cells aggregation as a plain table (counts + hit-rate)", () => {
    const { container } = render(<RCalibrationViewer selected={selected} onClose={vi.fn()} />);
    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    const text = table?.textContent ?? "";
    // Column headers + numeric cells.
    expect(text).toMatch(/verdict/);
    expect(text).toMatch(/hit-rate/);
    // 6/8 → 75%, 4/4 → 100% (mechanical rates, no appraisal).
    expect(text).toMatch(/75%/);
    expect(text).toMatch(/100%/);
  });

  it("renders tier-1 violations with full per-entry detail and a plain (tier-1) suffix", () => {
    render(<RCalibrationViewer selected={selected} onClose={vi.fn()} />);
    expect(screen.getByText("20260512-0900-tripwire.md")).toBeTruthy();
    expect(screen.getByText(/named a contract surface/)).toBeTruthy();
    expect(screen.getByText("(tier-1)")).toBeTruthy();
    // verdict / confidence / tier_routed line.
    expect(screen.getByText(/verdict escalate · confidence high · tier 1/)).toBeTruthy();
    // outcome + synthesis_pass_id facts.
    expect(screen.getByText(/revert deadbeef \(2026-05-14\)/)).toBeTruthy();
    expect(screen.getByText(/pass pass-tier1/)).toBeTruthy();
  });

  it("renders recent false-negatives with full per-entry detail", () => {
    render(<RCalibrationViewer selected={selected} onClose={vi.fn()} />);
    expect(screen.getByText("20260511-1200-missed.md")).toBeTruthy();
    expect(screen.getByText(/absorbed but the world later disagreed/)).toBeTruthy();
    expect(screen.getByText(/ci-fail-fix PR #700 → #701/)).toBeTruthy();
  });

  it("renders 'none observed yet' for an entry with a null outcome", () => {
    useCalibrationMock.mockReturnValue(
      result({
        data: response({
          tier1_violations: [],
          recent_false_negatives: [entry({ outcome: null })],
        }),
      }),
    );
    render(<RCalibrationViewer selected={selected} onClose={vi.fn()} />);
    expect(screen.getByText(/outcome none observed yet/)).toBeTruthy();
  });

  it("shows plain empty states (no aggregation cells / no entries)", () => {
    useCalibrationMock.mockReturnValue(
      result({
        data: response({ cells: [], tier1_violations: [], recent_false_negatives: [] }),
      }),
    );
    render(<RCalibrationViewer selected={selected} onClose={vi.fn()} />);
    expect(screen.getByText("No aggregation cells.")).toBeTruthy();
    // Both entry sections show their plain "None." empty state.
    const tier1 = screen.getByText(/Tier-1 violations \(0\)/).closest("section");
    expect(tier1).not.toBeNull();
    expect(within(tier1 as HTMLElement).getByText("None.")).toBeTruthy();
  });

  it("uses NO severity-color classes anywhere (plain-everything — no red even on tier-1)", () => {
    const { container } = render(<RCalibrationViewer selected={selected} onClose={vi.fn()} />);
    const html = container.innerHTML;
    expect(html).not.toMatch(/text-(warning|destructive|success)/);
  });

  it("fills the R region — no fixed clamp width, carries flex-1 (focus mode rides the R column)", () => {
    const { container } = render(<RCalibrationViewer selected={selected} onClose={vi.fn()} />);
    const root = container.querySelector('[data-testid="r-calibration-viewer"]');
    expect(root).not.toBeNull();
    expect(root?.className ?? "").not.toMatch(/w-\[/);
    expect(root?.className ?? "").toMatch(/flex-1/);
  });

  it("returns to the inventory via the ‹ Inventory back affordance (clears the focus)", () => {
    const onClose = vi.fn();
    render(<RCalibrationViewer selected={selected} onClose={onClose} />);
    screen.getByRole("button", { name: /Back to inventory/ }).click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders the loading and error states plainly", () => {
    useCalibrationMock.mockReturnValue(result({ data: null, loading: true }));
    const { rerender, container } = render(
      <RCalibrationViewer selected={selected} onClose={vi.fn()} />,
    );
    expect(screen.getByText("Loading…")).toBeTruthy();

    useCalibrationMock.mockReturnValue(
      result({ data: null, loading: false, error: new Error("boom") }),
    );
    rerender(<RCalibrationViewer selected={selected} onClose={vi.fn()} />);
    expect(screen.getByText(/Failed to load calibration: boom/)).toBeTruthy();
    expect(container.innerHTML).not.toMatch(/text-(warning|destructive|success)/);
  });
});
