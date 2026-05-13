// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CalibrationResponse } from "@/lib/api";
import { CalibrationChip } from "../CalibrationChip";

function makeData(overrides: Partial<CalibrationResponse> = {}): CalibrationResponse {
  return {
    unit: "u",
    days: 90,
    total_in_store: 0,
    total_in_window: 0,
    bootstrap_threshold: 50,
    cells: [],
    tier1_routed: 0,
    tier1_violations: [],
    recent_false_negatives: [],
    ...overrides,
  };
}

describe("CalibrationChip", () => {
  it("renders nothing when there is no data", () => {
    const { container } = render(<CalibrationChip data={null} onClick={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing on a completely empty store (no entries, no tripwire)", () => {
    // DR §B.4: a non-empty tripwire list IS the alarm; conversely, a
    // pristine store should be quiet — no chip, no noise.
    const { container } = render(<CalibrationChip data={makeData()} onClick={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the muted chip when the store has entries but no tripwire", () => {
    render(
      <CalibrationChip
        data={makeData({ total_in_store: 3, total_in_window: 2 })}
        onClick={vi.fn()}
      />,
    );
    const btn = screen.getByRole("button");
    expect(btn.textContent).toContain("cal 2");
    expect(btn.className).toContain("zinc"); // muted, not red
  });

  it("renders the urgent ⚡N chip when tier-1 tripwire violations exist", () => {
    // DR §B.4 zero tolerance: we don't gate on count; one is enough.
    const tripped = makeData({
      total_in_store: 1,
      total_in_window: 1,
      tier1_violations: [
        {
          synthesis_pass_id: "p",
          note_source: "n.md",
          verdict: "absorb",
          confidence: "high",
          tier_routed: 1,
          rationale: "wrong",
          recorded_at: "2026-05-13T10:00:00Z",
          outcome: null,
        },
      ],
    });
    render(<CalibrationChip data={tripped} onClick={vi.fn()} />);
    const btn = screen.getByRole("button");
    expect(btn.textContent ?? "").toMatch(/⚡\s*1/);
    expect(btn.className).toContain("red");
  });
});
