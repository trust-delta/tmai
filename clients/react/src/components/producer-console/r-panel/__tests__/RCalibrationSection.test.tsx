// @vitest-environment jsdom
//
// RCalibrationSection — header `N` total-in-window count + entries
// date desc body, no severity coloring.

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CalibrationResponse } from "@/lib/api";

const calibrationMock = vi.fn();

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      calibration: (...args: unknown[]) => calibrationMock(...args),
    },
  };
});

import { RCalibrationSection } from "../RCalibrationSection";

function response(overrides: Partial<CalibrationResponse> = {}): CalibrationResponse {
  return {
    unit: "u",
    days: 90,
    total_in_store: 5,
    total_in_window: 3,
    bootstrap_threshold: 10,
    cells: [],
    tier1_routed: 0,
    tier1_violations: [],
    recent_false_negatives: [],
    ...overrides,
  };
}

beforeEach(() => {
  calibrationMock.mockReset();
});

describe("RCalibrationSection", () => {
  it("header shows total_in_window count from the wire", async () => {
    calibrationMock.mockResolvedValue(response({ total_in_window: 7 }));
    render(<RCalibrationSection unitName="u" expanded={false} onToggle={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText(/^7$/)).toBeTruthy();
    });
  });

  it("body shows the friendly message when no tripwires or false-negatives", async () => {
    calibrationMock.mockResolvedValue(response());
    render(<RCalibrationSection unitName="u" expanded={true} onToggle={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText(/no tripwires or false-negatives/i)).toBeTruthy();
    });
  });

  it("uses no severity colors in rendered output", async () => {
    calibrationMock.mockResolvedValue(response());
    const { container } = render(
      <RCalibrationSection unitName="u" expanded={true} onToggle={vi.fn()} />,
    );
    await waitFor(() => {
      expect(screen.getByText(/no tripwires/i)).toBeTruthy();
    });
    expect(container.innerHTML).not.toMatch(/text-warning|text-destructive|text-success/);
  });
});
