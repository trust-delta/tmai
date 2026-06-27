// @vitest-environment jsdom
//
// SettingsPanel layout tests — Phase B reorg.
//
// We mock every sub-section so the test exercises only the shell:
// section ordering, the new Advanced expandable, and the
// `defaultOpenAdvanced` prop wired by App.tsx when the operator
// deep-links from the ProducerConsole override panel.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "../SettingsPanel";

vi.mock("@/lib/api", () => ({
  api: { listAgents: vi.fn().mockResolvedValue([]) },
  groupByProject: vi.fn().mockReturnValue([]),
}));

vi.mock("../GeneralSection", () => ({
  GeneralSection: () => <div data-testid="section-general">General</div>,
}));
vi.mock("../HandoffThresholdSection", () => ({
  HandoffThresholdSection: () => <div data-testid="section-handoff-threshold">Handoff</div>,
}));
vi.mock("../NotificationSection", () => ({
  NotificationSection: () => <div data-testid="section-notification">Notification</div>,
}));
vi.mock("../ProducerSection", () => ({
  ProducerSection: () => <div data-testid="section-orchestration">Orchestration</div>,
}));
vi.mock("../ProducerDispatchSection", () => ({
  ProducerDispatchSection: () => <div data-testid="section-dispatch">Dispatch</div>,
}));
vi.mock("../WorkflowSection", () => ({
  WorkflowSection: () => <div data-testid="section-workflow">Workflow</div>,
}));
vi.mock("../WorktreeSection", () => ({
  WorktreeSection: () => <div data-testid="section-worktree">Worktree</div>,
}));
vi.mock("../DisplayLayoutSection", () => ({
  DisplayLayoutSection: () => <div data-testid="section-display">Display</div>,
}));
vi.mock("../ThemeSection", () => ({
  ThemeSection: () => <div data-testid="section-theme">Theme</div>,
}));

const ADVANCED_TESTIDS = [
  "section-orchestration",
  "section-dispatch",
  "section-workflow",
  "section-worktree",
];

describe("SettingsPanel — Phase B layout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the Producer-group sections directly (not behind an expandable)", () => {
    render(<SettingsPanel onClose={vi.fn()} />);

    expect(screen.getByTestId("section-general")).toBeTruthy();
    expect(screen.getByTestId("section-handoff-threshold")).toBeTruthy();
    expect(screen.getByTestId("section-notification")).toBeTruthy();
  });

  it("renders the WebUI-group sections directly", () => {
    render(<SettingsPanel onClose={vi.fn()} />);

    expect(screen.getByTestId("section-display")).toBeTruthy();
    expect(screen.getByTestId("section-theme")).toBeTruthy();
  });

  it("puts the theme switcher in the primary flow, not behind Advanced", () => {
    render(<SettingsPanel onClose={vi.fn()} />);

    const details = screen.getByText(/Advanced/).closest("details");
    expect(details?.contains(screen.getByTestId("section-theme"))).toBe(false);
  });

  it("keeps the Advanced sections hidden by default", () => {
    render(<SettingsPanel onClose={vi.fn()} />);

    const details = screen.getByText(/Advanced/).closest("details");
    expect(details).toBeTruthy();
    expect((details as HTMLDetailsElement).open).toBe(false);
    // jsdom collapses <details> content visually via the open attr;
    // mocked sections still mount in the DOM, so assert on the
    // `open` attribute rather than visibility.
  });

  it("opens the Advanced section when defaultOpenAdvanced is true", () => {
    render(<SettingsPanel onClose={vi.fn()} defaultOpenAdvanced={true} />);

    const details = screen.getByText(/Advanced/).closest("details");
    expect((details as HTMLDetailsElement).open).toBe(true);
  });

  it("mounts all advanced sub-sections inside the Advanced details", () => {
    render(<SettingsPanel onClose={vi.fn()} defaultOpenAdvanced={true} />);

    const details = screen.getByText(/Advanced/).closest("details");
    expect(details).toBeTruthy();
    for (const testId of ADVANCED_TESTIDS) {
      const node = screen.getByTestId(testId);
      // Every advanced section should be inside the <details> subtree.
      expect(details?.contains(node)).toBe(true);
    }
  });

  it("invokes onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    render(<SettingsPanel onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: /Close/ }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
