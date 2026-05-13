// @vitest-environment jsdom
//
// ProducerConsoleActions — clipboard copy, calibration jump, and
// the Phase-B operator-override stub.

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CalibrationResponse } from "@/lib/api";
import { ProducerConsoleActions } from "../ProducerConsoleActions";

function calibrationFixture(overrides: Partial<CalibrationResponse> = {}): CalibrationResponse {
  return {
    unit: overrides.unit ?? "test-unit",
    days: overrides.days ?? 90,
    total_in_store: overrides.total_in_store ?? 5,
    total_in_window: overrides.total_in_window ?? 5,
    bootstrap_threshold: overrides.bootstrap_threshold ?? 10,
    cells: overrides.cells ?? [],
    tier1_routed: overrides.tier1_routed ?? 0,
    tier1_violations: overrides.tier1_violations ?? [],
    recent_false_negatives: overrides.recent_false_negatives ?? [],
  };
}

describe("ProducerConsoleActions", () => {
  it("disables both real-action buttons when unitName is null", () => {
    render(
      <ProducerConsoleActions
        unitName={null}
        calibrationData={null}
        onOpenProducerTerminal={vi.fn()}
        onOpenCalibration={vi.fn()}
      />,
    );

    const openTerm = screen.getByRole("button", { name: /Open Producer terminal/ });
    const openCal = screen.getByRole("button", { name: /Calibration/ });
    expect(openTerm).toHaveProperty("disabled", true);
    expect(openCal).toHaveProperty("disabled", true);
  });

  it("invokes onOpenProducerTerminal when the terminal button is clicked", () => {
    const onOpenTerm = vi.fn();
    render(
      <ProducerConsoleActions
        unitName="my-unit"
        calibrationData={null}
        onOpenProducerTerminal={onOpenTerm}
        onOpenCalibration={vi.fn()}
      />,
    );

    screen.getByRole("button", { name: /Open Producer terminal/ }).click();
    expect(onOpenTerm).toHaveBeenCalledTimes(1);
  });

  it("invokes onOpenCalibration when the calibration button is clicked", () => {
    const onOpenCal = vi.fn();
    render(
      <ProducerConsoleActions
        unitName="my-unit"
        calibrationData={null}
        onOpenProducerTerminal={vi.fn()}
        onOpenCalibration={onOpenCal}
      />,
    );

    screen.getByRole("button", { name: /Calibration/ }).click();
    expect(onOpenCal).toHaveBeenCalledTimes(1);
  });

  it("badges the calibration button with the tripwire count when non-empty", () => {
    render(
      <ProducerConsoleActions
        unitName="my-unit"
        calibrationData={calibrationFixture({
          tier1_violations: [
            {
              verdict: "absorb",
              note_source: "x",
              confidence: "high",
              synthesis_pass_id: "p1",
              tier_routed: 1,
              rationale: "r",
              recorded_at: "2026-05-13",
              outcome: null,
            },
          ],
        })}
        onOpenProducerTerminal={vi.fn()}
        onOpenCalibration={vi.fn()}
      />,
    );

    expect(screen.getByText(/⚡ 1/)).toBeTruthy();
  });

  it("shows the cal count when tripwire is empty but store has entries", () => {
    render(
      <ProducerConsoleActions
        unitName="my-unit"
        calibrationData={calibrationFixture({
          total_in_window: 7,
          tier1_violations: [],
        })}
        onOpenProducerTerminal={vi.fn()}
        onOpenCalibration={vi.fn()}
      />,
    );

    expect(screen.getByText("7")).toBeTruthy();
  });

  it("renders the Phase-B operator override as a non-interactive stub", () => {
    render(
      <ProducerConsoleActions
        unitName="my-unit"
        calibrationData={null}
        onOpenProducerTerminal={vi.fn()}
        onOpenCalibration={vi.fn()}
      />,
    );
    expect(screen.getByText(/Operator override/)).toBeTruthy();
    expect(screen.getByText(/phase B/i)).toBeTruthy();
  });
});
