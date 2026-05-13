// @vitest-environment jsdom
//
// ProducerConsoleActions — top row, operator-override expandable
// (Phase B), and DirBrowser-backed Producer launch when unit is
// unresolved (Phase B polish v3). NewAgentLauncher + DirBrowser
// + `api.getGeneralSettings` are mocked so we don't pull live
// network calls into render.

import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CalibrationResponse } from "@/lib/api";
import { ProducerConsoleActions } from "../ProducerConsoleActions";

vi.mock("@/components/project/NewAgentLauncher", () => ({
  NewAgentLauncher: () => (
    <div data-testid="mock-new-agent-launcher">[mocked NewAgentLauncher]</div>
  ),
}));

vi.mock("@/components/project/DirBrowser", () => ({
  DirBrowser: (props: {
    onCancel: () => void;
    actionSlot?: (currentPath: string) => ReactNode;
    startPath?: string | null;
  }) => (
    <div data-testid="mock-dirbrowser" data-start-path={props.startPath ?? ""}>
      <button type="button" data-testid="mock-dirbrowser-cancel" onClick={props.onCancel}>
        cancel
      </button>
      {props.actionSlot?.("/picked/path")}
    </div>
  ),
}));

vi.mock("@/lib/api", () => ({
  api: {
    getGeneralSettings: vi.fn().mockResolvedValue({ default_project_root: null }),
  },
}));

import type { ComponentProps } from "react";

function makeProps(
  overrides: Partial<ComponentProps<typeof ProducerConsoleActions>> = {},
): ComponentProps<typeof ProducerConsoleActions> {
  return {
    unitName: "u",
    calibrationData: null,
    onOpenProducerTerminal: vi.fn(),
    onLaunchProducerAt: vi.fn(),
    onOpenCalibration: vi.fn(),
    onOverrideSpawned: vi.fn(),
    onOpenSidebar: vi.fn(),
    sidebarCollapsed: false,
    onOpenSettings: vi.fn(),
    ...overrides,
  };
}

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

describe("ProducerConsoleActions — top row", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps Open-Producer-terminal enabled even when unitName is null", () => {
    // Phase B polish v3 fix: when no project is selected yet, the
    // button should still be clickable and route to the DirBrowser
    // path (not disabled). Calibration stays disabled because it
    // needs an explicit unit.
    render(<ProducerConsoleActions {...makeProps({ unitName: null })} />);

    const openTerm = screen.getByRole("button", { name: /Open Producer terminal/ });
    const openCal = screen.getByRole("button", { name: /Calibration/ });
    expect(openTerm).toHaveProperty("disabled", false);
    expect(openCal).toHaveProperty("disabled", true);
  });

  it("invokes onOpenProducerTerminal when unitName is resolved and the button is clicked", () => {
    const onOpenTerm = vi.fn();
    const onLaunchAt = vi.fn();
    render(
      <ProducerConsoleActions
        {...makeProps({
          unitName: "my-unit",
          onOpenProducerTerminal: onOpenTerm,
          onLaunchProducerAt: onLaunchAt,
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Open Producer terminal/ }));
    expect(onOpenTerm).toHaveBeenCalledTimes(1);
    expect(onLaunchAt).not.toHaveBeenCalled();
    // No DirBrowser when we have a unit already.
    expect(screen.queryByTestId("mock-dirbrowser")).toBeNull();
  });

  it("opens DirBrowser when unitName is null and the button is clicked", () => {
    const onOpenTerm = vi.fn();
    render(
      <ProducerConsoleActions
        {...makeProps({ unitName: null, onOpenProducerTerminal: onOpenTerm })}
      />,
    );

    expect(screen.queryByTestId("mock-dirbrowser")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Open Producer terminal/ }));
    expect(screen.getByTestId("mock-dirbrowser")).toBeTruthy();
    // The hot-path callback should NOT have been fired — we routed to
    // the picker instead.
    expect(onOpenTerm).not.toHaveBeenCalled();
  });

  it("forwards the picked path to onLaunchProducerAt and closes the browser", () => {
    const onLaunchAt = vi.fn();
    render(
      <ProducerConsoleActions {...makeProps({ unitName: null, onLaunchProducerAt: onLaunchAt })} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Open Producer terminal/ }));
    // Mock DirBrowser renders the actionSlot with `"/picked/path"`.
    fireEvent.click(screen.getByRole("button", { name: /Launch Producer here/ }));
    expect(onLaunchAt).toHaveBeenCalledWith("/picked/path");
    // Modal should close after the pick.
    expect(screen.queryByTestId("mock-dirbrowser")).toBeNull();
  });

  it("invokes onOpenCalibration when the calibration button is clicked", () => {
    const onOpenCal = vi.fn();
    render(
      <ProducerConsoleActions
        {...makeProps({ unitName: "my-unit", onOpenCalibration: onOpenCal })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Calibration/ }));
    expect(onOpenCal).toHaveBeenCalledTimes(1);
  });

  it("badges the calibration button with the tripwire count when non-empty", () => {
    render(
      <ProducerConsoleActions
        {...makeProps({
          unitName: "my-unit",
          calibrationData: calibrationFixture({
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
          }),
        })}
      />,
    );

    expect(screen.getByText(/⚡ 1/)).toBeTruthy();
  });

  it("shows the cal count when tripwire is empty but store has entries", () => {
    render(
      <ProducerConsoleActions
        {...makeProps({
          unitName: "my-unit",
          calibrationData: calibrationFixture({
            total_in_window: 7,
            tier1_violations: [],
          }),
        })}
      />,
    );

    expect(screen.getByText("7")).toBeTruthy();
  });
});

describe("ProducerConsoleActions — operator override (Phase B)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the override toggle button collapsed by default", () => {
    render(<ProducerConsoleActions {...makeProps()} />);

    const toggle = screen.getByRole("button", { name: /Operator override/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("mock-new-agent-launcher")).toBeNull();
  });

  it("expands the override panel and reveals NewAgentLauncher on toggle click", () => {
    render(<ProducerConsoleActions {...makeProps()} />);

    const toggle = screen.getByRole("button", { name: /Operator override/ });
    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("mock-new-agent-launcher")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Open Settings/ })).toBeTruthy();
  });

  it("collapses the override panel on a second click", () => {
    render(<ProducerConsoleActions {...makeProps()} />);

    const toggle = screen.getByRole("button", { name: /Operator override/ });
    fireEvent.click(toggle);
    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("mock-new-agent-launcher")).toBeNull();
  });

  it("hides the Show-sidebar button when sidebarCollapsed is false", () => {
    render(<ProducerConsoleActions {...makeProps({ sidebarCollapsed: false })} />);

    fireEvent.click(screen.getByRole("button", { name: /Operator override/ }));
    expect(screen.queryByRole("button", { name: /Show sidebar/ })).toBeNull();
  });

  it("shows the Show-sidebar button when sidebarCollapsed is true", () => {
    render(<ProducerConsoleActions {...makeProps({ sidebarCollapsed: true })} />);

    fireEvent.click(screen.getByRole("button", { name: /Operator override/ }));
    expect(screen.getByRole("button", { name: /Show sidebar/ })).toBeTruthy();
  });

  it("invokes onOpenSidebar when the Show-sidebar button is clicked", () => {
    const onOpenSidebar = vi.fn();
    render(<ProducerConsoleActions {...makeProps({ sidebarCollapsed: true, onOpenSidebar })} />);

    fireEvent.click(screen.getByRole("button", { name: /Operator override/ }));
    fireEvent.click(screen.getByRole("button", { name: /Show sidebar/ }));

    expect(onOpenSidebar).toHaveBeenCalledTimes(1);
  });

  it("invokes onOpenSettings when the Open-Settings button is clicked", () => {
    const onOpenSettings = vi.fn();
    render(<ProducerConsoleActions {...makeProps({ onOpenSettings })} />);

    fireEvent.click(screen.getByRole("button", { name: /Operator override/ }));
    fireEvent.click(screen.getByRole("button", { name: /Open Settings/ }));

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });
});
