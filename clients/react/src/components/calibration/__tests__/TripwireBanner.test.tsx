// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CalibrationEntry, CalibrationResponse } from "@/lib/api";
import { TripwireBanner } from "../TripwireBanner";

function entry(overrides: Partial<CalibrationEntry> = {}): CalibrationEntry {
  return {
    synthesis_pass_id: "p",
    note_source: "note.md",
    verdict: "Absorb",
    confidence: "High",
    tier_routed: 1,
    rationale: "default",
    recorded_at: "2026-05-13T10:00:00Z",
    outcome: null,
    ...overrides,
  };
}

function dataWith(violations: CalibrationEntry[]): CalibrationResponse {
  return {
    unit: "tmai-core",
    days: 90,
    total_in_store: violations.length,
    total_in_window: violations.length,
    bootstrap_threshold: 50,
    cells: [],
    tier1_routed: violations.length,
    tier1_violations: violations,
    recent_false_negatives: [],
  };
}

describe("TripwireBanner", () => {
  it("renders nothing when data is null", () => {
    const { container } = render(<TripwireBanner data={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing on an empty violation list (DR §B.4: list IS the alarm)", () => {
    const { container } = render(<TripwireBanner data={dataWith([])} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the banner with each violation's note_source + rationale", () => {
    const data = dataWith([
      entry({ note_source: "20260513-1000-a.md", rationale: "should have escalated" }),
      entry({
        note_source: "20260513-1100-b.md",
        verdict: "TradeoffProposal",
        rationale: "tier-1 means human-only",
      }),
    ]);
    render(<TripwireBanner data={data} />);
    expect(screen.getByText(/TIER-1 TRIPWIRE TRIGGERED/)).toBeTruthy();
    expect(screen.getByText("20260513-1000-a.md")).toBeTruthy();
    expect(screen.getByText("20260513-1100-b.md")).toBeTruthy();
    expect(screen.getByText(/should have escalated/)).toBeTruthy();
    expect(screen.getByText(/tier-1 means human-only/)).toBeTruthy();
  });

  it("caps the visible list at 5 entries and shows an overflow line", () => {
    const data = dataWith(
      Array.from({ length: 7 }, (_, i) =>
        entry({ note_source: `note-${i}.md`, rationale: `r${i}` }),
      ),
    );
    render(<TripwireBanner data={data} />);
    expect(screen.getByText("note-0.md")).toBeTruthy();
    expect(screen.getByText("note-4.md")).toBeTruthy();
    expect(screen.queryByText("note-5.md")).toBeNull();
    expect(screen.getByText(/and 2 more/)).toBeTruthy();
  });
});
