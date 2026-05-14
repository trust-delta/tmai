// @vitest-environment jsdom
//
// Overlay smoke tests — assert phase rows render with the expected
// mark per state-machine position. We pin to `data-testid` +
// `data-status` rather than visible mark glyphs so any future glyph
// swap doesn't break the assertions.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { HandoffRitualEvent } from "@/lib/api";
import { HandoffRitualOverlay } from "../HandoffRitualOverlay";

function makeEvent(phase: HandoffRitualEvent["phase"]): HandoffRitualEvent {
  if (phase === "escalate") {
    return { unit: "tmai", ritual_id: "r-1", phase: "escalate", reason: "timeout" };
  }
  if (phase === "ready") {
    return { unit: "tmai", ritual_id: "r-1", phase: "ready" };
  }
  return { unit: "tmai", ritual_id: "r-1", phase };
}

describe("HandoffRitualOverlay", () => {
  it("renders the five forward phase rows", () => {
    render(<HandoffRitualOverlay unitName="tmai" ritualId="r-1" phases={[]} />);
    expect(screen.getByTestId("phase-row-prompted")).toBeTruthy();
    expect(screen.getByTestId("phase-row-validated")).toBeTruthy();
    expect(screen.getByTestId("phase-row-killed")).toBeTruthy();
    expect(screen.getByTestId("phase-row-launching")).toBeTruthy();
    expect(screen.getByTestId("phase-row-ready")).toBeTruthy();
  });

  it("marks the first row as current when no events have arrived", () => {
    render(<HandoffRitualOverlay unitName="tmai" ritualId="r-1" phases={[]} />);
    expect(screen.getByTestId("phase-row-prompted").getAttribute("data-status")).toBe("current");
    expect(screen.getByTestId("phase-row-validated").getAttribute("data-status")).toBe("pending");
  });

  it("marks observed phases as done and the latest as current", () => {
    render(
      <HandoffRitualOverlay
        unitName="tmai"
        ritualId="r-1"
        phases={[makeEvent("prompted"), makeEvent("validated"), makeEvent("killed")]}
      />,
    );
    expect(screen.getByTestId("phase-row-prompted").getAttribute("data-status")).toBe("done");
    expect(screen.getByTestId("phase-row-validated").getAttribute("data-status")).toBe("done");
    expect(screen.getByTestId("phase-row-killed").getAttribute("data-status")).toBe("current");
    expect(screen.getByTestId("phase-row-launching").getAttribute("data-status")).toBe("pending");
    expect(screen.getByTestId("phase-row-ready").getAttribute("data-status")).toBe("pending");
  });

  it("renders the unit name and ritual id", () => {
    render(<HandoffRitualOverlay unitName="my-unit" ritualId="abc123" phases={[]} />);
    expect(screen.getByText(/my-unit/)).toBeTruthy();
    expect(screen.getByText(/ritual_id: abc123/)).toBeTruthy();
  });

  it("omits the ritual_id line when ritualId is null", () => {
    render(<HandoffRitualOverlay unitName="my-unit" ritualId={null} phases={[]} />);
    expect(screen.queryByText(/ritual_id/)).toBeNull();
  });

  it("exposes a dialog role for accessibility", () => {
    render(<HandoffRitualOverlay unitName="tmai" ritualId="r-1" phases={[]} />);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});
