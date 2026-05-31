// @vitest-environment jsdom
//
// RPanel — accordion shell + section persistence + collapsed rail.
// The seven section bodies are mocked so this test only proves the
// container behaviour (default-collapsed accordion, operator-toggled
// expand, localStorage persistence, no severity colors in rendered
// output) plus the relocated Δ stream trigger button.

import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ProducerFeedStatus } from "@/lib/api";
import { renderWithProviders } from "@/test/render";

vi.mock("../RPrsSection", () => ({
  RPrsSection: ({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) => (
    <button type="button" data-testid="prs-section" data-expanded={expanded} onClick={onToggle}>
      PRs
    </button>
  ),
}));
vi.mock("../RIssuesSection", () => ({
  RIssuesSection: ({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) => (
    <button type="button" data-testid="issues-section" data-expanded={expanded} onClick={onToggle}>
      Issues
    </button>
  ),
}));
vi.mock("../RDecisionsSection", () => ({
  RDecisionsSection: ({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) => (
    <button
      type="button"
      data-testid="decisions-section"
      data-expanded={expanded}
      onClick={onToggle}
    >
      Decisions
    </button>
  ),
}));
vi.mock("../RApproachesSection", () => ({
  RApproachesSection: ({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) => (
    <button
      type="button"
      data-testid="approaches-section"
      data-expanded={expanded}
      onClick={onToggle}
    >
      Approaches
    </button>
  ),
}));
vi.mock("../RCalibrationSection", () => ({
  RCalibrationSection: ({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) => (
    <button
      type="button"
      data-testid="calibration-section"
      data-expanded={expanded}
      onClick={onToggle}
    >
      Calibration
    </button>
  ),
}));
vi.mock("../RHandoverSection", () => ({
  RHandoverSection: ({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) => (
    <button
      type="button"
      data-testid="handover-section"
      data-expanded={expanded}
      onClick={onToggle}
    >
      Handover
    </button>
  ),
}));
vi.mock("../RFilesSection", () => ({
  RFilesSection: ({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) => (
    <button type="button" data-testid="files-section" data-expanded={expanded} onClick={onToggle}>
      Files
    </button>
  ),
}));

import { RPanel, type RPanelResize } from "../RPanel";

function feedFixture(overrides: Partial<ProducerFeedStatus> = {}): ProducerFeedStatus {
  return {
    unit: "u",
    producer_address: "u.producer",
    tip: 0n,
    last_served_cursor: 0n,
    has_pending_delta: undefined,
    ...overrides,
  };
}

function makeResize(overrides: Partial<RPanelResize> = {}): RPanelResize {
  return {
    width: 320,
    isResizing: false,
    ratio: 0.5,
    onMouseDown: vi.fn(),
    onDoubleClick: vi.fn(),
    onAdjust: vi.fn(),
    ...overrides,
  };
}

function makeProps(overrides: Partial<Parameters<typeof RPanel>[0]> = {}) {
  return {
    currentProjectPath: "/p/u",
    unitName: "u",
    producerFeedData: feedFixture(),
    onTriggerDeltaPull: vi.fn(),
    producerAvailable: true,
    collapsed: false,
    onToggleCollapsed: vi.fn(),
    resize: makeResize(),
    ...overrides,
  };
}

describe("RPanel — accordion shell", () => {
  it("renders all seven sections, all collapsed by default (no tmai-side expand pick)", () => {
    // Use a fresh localStorage by setting the key to empty before mount.
    localStorage.setItem("tmai:ui:prefs", JSON.stringify({ rPanelExpandedSections: [] }));

    renderWithProviders(<RPanel {...makeProps()} />);

    const ids = [
      "prs-section",
      "issues-section",
      "decisions-section",
      "approaches-section",
      "calibration-section",
      "handover-section",
      "files-section",
    ];
    for (const id of ids) {
      const el = screen.getByTestId(id);
      expect(el.getAttribute("data-expanded")).toBe("false");
    }
  });

  it("click on a section toggles + persists via localStorage", () => {
    localStorage.setItem("tmai:ui:prefs", JSON.stringify({ rPanelExpandedSections: [] }));

    renderWithProviders(<RPanel {...makeProps()} />);

    fireEvent.click(screen.getByTestId("decisions-section"));
    expect(screen.getByTestId("decisions-section").getAttribute("data-expanded")).toBe("true");

    const raw = localStorage.getItem("tmai:ui:prefs") ?? "{}";
    const parsed = JSON.parse(raw) as { rPanelExpandedSections: string[] };
    expect(parsed.rPanelExpandedSections).toContain("decisions");
  });

  it("restores expanded sections from persisted prefs on mount", () => {
    localStorage.setItem(
      "tmai:ui:prefs",
      JSON.stringify({ rPanelExpandedSections: ["prs", "handover"] }),
    );

    renderWithProviders(<RPanel {...makeProps()} />);

    expect(screen.getByTestId("prs-section").getAttribute("data-expanded")).toBe("true");
    expect(screen.getByTestId("handover-section").getAttribute("data-expanded")).toBe("true");
    expect(screen.getByTestId("decisions-section").getAttribute("data-expanded")).toBe("false");
  });

  it("collapses to a rail that hides the sections and exposes an expand control", () => {
    const onToggle = vi.fn();
    renderWithProviders(
      <RPanel {...makeProps({ collapsed: true, onToggleCollapsed: onToggle })} />,
    );

    const panel = screen.getByTestId("r-panel");
    expect(panel.getAttribute("data-collapsed")).toBe("true");
    expect(screen.queryByTestId("prs-section")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Expand R panel/ }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("focus mode: renders the viewer in place of the inventory (toggles, never stacks)", () => {
    // A focus is set → RPanel renders the R₂ viewer node IN the same column
    // (same drag-set width) instead of the R₁ inventory body. There is no
    // additive second column — the load-bearing C-width invariant.
    renderWithProviders(
      <RPanel {...makeProps({ viewer: <div data-testid="r2-viewer-stub">viewer</div> })} />,
    );

    const panel = screen.getByTestId("r-panel");
    // The viewer rides the SAME R panel column slot…
    expect(within(panel).getByTestId("r2-viewer-stub")).toBeTruthy();
    // …and the inventory sections are NOT additionally rendered (swap, not stack).
    expect(screen.queryByTestId("prs-section")).toBeNull();
    expect(screen.queryByTestId("decisions-section")).toBeNull();
    expect(screen.queryByTestId("files-section")).toBeNull();
    // Drag-resize machinery is preserved on the focused column.
    expect(within(panel).getByRole("separator", { name: /Resize R panel/ })).toBeTruthy();
  });

  it("uses NO severity-color classes in the rendered output (negative-space)", () => {
    const { container } = renderWithProviders(<RPanel {...makeProps()} />);
    const html = container.innerHTML;
    // Negative space: R must not surface warning / destructive / success
    // / primary saliency — the operator's appraisal is the only one.
    expect(html).not.toMatch(/text-warning/);
    expect(html).not.toMatch(/text-destructive/);
    expect(html).not.toMatch(/text-success/);
  });

  it("does NOT render priority / sort / needs-you filter controls (negative-space)", () => {
    renderWithProviders(<RPanel {...makeProps()} />);
    // No "needs you" filter chip / no "sort" affordance / no "priority" pill.
    expect(screen.queryByText(/needs you/i)).toBeNull();
    expect(screen.queryByText(/sort by/i)).toBeNull();
    expect(screen.queryByText(/priority/i)).toBeNull();
  });
});
