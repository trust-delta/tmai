// @vitest-environment jsdom
//
// App layout test for the R panel (approach
// `doc/approaches/2026-05-29-r-panel-as-project-artifact-inventory.md`).
// This is a *layout* test: it asserts WHERE the R panel sits in App's
// flex tree and WHEN it shows — not the panel's internals (those are
// covered by RPanel.test.tsx). So we stub the panel (and every heavy
// other panel) and drive App's selection / breakpoint state through
// mocked hooks.
//
// The load-bearing assertions:
//   1. with no agent selected, the centre shows the digest AND the R
//      panel is present;
//   2. after selecting an agent the centre swaps to the SINGLE-PANE
//      agent view but the R panel STAYS present — co-visibility
//      kills the digest↔conversation screen-switch;
//   3. on a narrow viewport the R panel is gone — its guard reads
//      isNarrowScreen off the sole surviving useSplitPane;
//   4. a cross-unit click re-scopes currentProject instead of opening
//      a removed full-screen view;
//   5. FOCUS MODE: opening a viewer renders it INSIDE the single R panel
//      column (handed in as RPanel's `viewer` prop), never as an additive
//      sibling column — protecting the centre's width — and the ‹ Inventory
//      back affordance clears the focus to reveal the inventory again.

import { fireEvent, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSnapshot } from "@/lib/api";
import { renderWithProviders } from "@/test/render";

// ── hook mocks ──
const useAgentsMock = vi.fn();
const useResponsiveLayoutMock = vi.fn();
const useSplitPaneMock = vi.fn();

vi.mock("@/lib/sse-provider", () => ({
  useSSE: () => undefined,
  useSSEContext: () => ({
    cache: { agents: [], worktrees: [], queueEntries: [], loading: false },
    refreshCache: vi.fn(),
    subscribe: vi.fn(),
  }),
}));
vi.mock("@/hooks/useActiveTheme", () => ({ useApplyTheme: () => undefined }));
vi.mock("@/hooks/useAgents", () => ({ useAgents: () => useAgentsMock() }));
vi.mock("@/hooks/useWorktrees", () => ({
  useWorktrees: () => ({ worktrees: [], loading: false, refresh: vi.fn() }),
}));
vi.mock("@/hooks/useCalibration", () => ({
  useCalibration: () => ({ data: null, loading: false, error: null }),
}));
vi.mock("@/hooks/useNotificationConfig", () => ({ useNotificationConfig: () => ({}) }));
vi.mock("@/hooks/useIdleNotification", () => ({
  useIdleNotification: () => ({ handleAgentStopped: vi.fn() }),
}));
vi.mock("@/hooks/useResponsiveLayout", () => ({
  useResponsiveLayout: () => useResponsiveLayoutMock(),
}));
vi.mock("@/hooks/useSplitPane", () => ({
  useSplitPane: () => useSplitPaneMock(),
  makeSplitKeyHandler: () => () => undefined,
  RATIO_STEP: 0.025,
}));
vi.mock("@/hooks/useAgentSelectionFallback", () => ({
  useAgentSelectionFallback: () => undefined,
}));
vi.mock("@/hooks/useKeyboardShortcuts", () => ({ useKeyboardShortcuts: () => undefined }));
vi.mock("@/hooks/useProducerFeed", () => ({
  useProducerFeed: () => ({ data: null, loading: false, error: null }),
}));

// ── component stubs (everything heavy / networked) ──
// The R panel stub surfaces TWO focus-mode seams: (a) a `focus-pr` button
// wired to `onSelectPr` so a test can set the focus from the (stubbed)
// inventory, and (b) it renders the `viewer` prop in-place — so we can
// assert the viewer lands INSIDE this single column rather than as an
// additive sibling.
vi.mock("@/components/producer-console/r-panel/RPanel", () => ({
  RPanel: ({ viewer, onSelectPr }: { viewer?: ReactNode; onSelectPr?: (sel: unknown) => void }) => (
    <div data-testid="r-panel-stub">
      <button
        type="button"
        onClick={() =>
          onSelectPr?.({
            repoPath: "/p/alpha",
            repoLabel: "alpha",
            pr: { number: 5n },
            billingDead: false,
          })
        }
      >
        focus-pr
      </button>
      {viewer}
    </div>
  ),
}));
// The three R₂ viewers are stubbed to lightweight markers (the App test
// only cares about WHERE they render, not their content). Each module also
// exports the `selected*Key` helper App imports alongside the component.
vi.mock("@/components/producer-console/r-panel/r-viewer/RPrViewer", () => ({
  RPrViewer: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="r-pr-viewer-stub">
      <button type="button" onClick={onClose}>
        back-to-inventory
      </button>
    </div>
  ),
  selectedPrKey: () => "pr-key",
}));
vi.mock("@/components/producer-console/r-panel/r-viewer/RRecordViewer", () => ({
  RRecordViewer: () => <div data-testid="r-record-viewer-stub">record</div>,
  selectedRecordKey: () => "rec-key",
}));
vi.mock("@/components/producer-console/r-panel/r-viewer/RIssueViewer", () => ({
  RIssueViewer: () => <div data-testid="r-issue-viewer-stub">issue</div>,
  selectedIssueKey: () => "iss-key",
}));
// The console stub surfaces `currentProjectPath` and a button that fires
// `onSelectProjectByPath`, so the cross-unit re-scope reroute is
// observable at the App level without rendering the real digest.
vi.mock("@/components/producer-console/ProducerConsole", () => ({
  ProducerConsole: ({
    currentProjectPath,
    onSelectProjectByPath,
  }: {
    currentProjectPath: string | null;
    onSelectProjectByPath: (path: string, name: string) => void;
  }) => (
    <div data-testid="producer-console-stub">
      <span data-testid="console-current-project">{currentProjectPath ?? "none"}</span>
      <button type="button" onClick={() => onSelectProjectByPath("/p/beta", "beta")}>
        rescope-beta
      </button>
    </div>
  ),
}));
vi.mock("@/components/producer-console/ProducerConversationHeader", () => ({
  ProducerConversationHeader: () => (
    <div data-testid="conversation-header-stub">conversation-header</div>
  ),
}));
vi.mock("@/components/agent/PreviewPanel", () => ({
  PreviewPanel: () => <div data-testid="preview-stub">preview</div>,
}));
vi.mock("@/components/agent/AgentActions", () => ({ AgentActions: () => null }));
vi.mock("@/components/terminal/TerminalPanel", () => ({
  TerminalPanel: () => <div data-testid="terminal-stub">terminal</div>,
}));
vi.mock("@/components/agent/AgentList", () => ({ AgentList: () => null }));
vi.mock("@/components/terminal/TerminalList", () => ({ TerminalList: () => null }));
vi.mock("@/components/usage/UsagePanel", () => ({ UsagePanel: () => null }));
vi.mock("@/components/settings/SettingsPanel", () => ({ SettingsPanel: () => null }));
vi.mock("@/components/settings/SecurityPanel", () => ({ SecurityPanel: () => null }));
vi.mock("@/components/calibration/CalibrationPanel", () => ({ CalibrationPanel: () => null }));

import { App } from "@/App";

function agent(target: string, cwd: string): AgentSnapshot {
  return {
    id: target,
    target,
    agent_type: "ClaudeCode",
    title: target,
    cwd,
    display_cwd: cwd,
    display_name: target,
    detection_source: "HttpHook",
    git_branch: null,
    git_dirty: null,
    is_worktree: null,
    git_common_dir: null,
    worktree_name: null,
    worktree_base_branch: null,
    effort_level: null,
    active_subagents: 0,
    compaction_count: 0,
    pty_session_id: null,
    send_capability: "None",
    is_virtual: false,
    team_info: null,
    is_producer: false,
    attention: null,
  } as AgentSnapshot;
}

function responsive(overrides: Record<string, unknown> = {}) {
  return {
    sidebarCollapsed: true,
    toggleSidebar: vi.fn(),
    actionPanelCollapsed: true,
    toggleActionPanel: vi.fn(),
    isNarrowScreen: false,
    isMobileScreen: false,
    mobileDrawerOpen: false,
    toggleMobileDrawer: vi.fn(),
    closeMobileDrawer: vi.fn(),
    ...overrides,
  };
}

function splitPane(isNarrowScreen = false) {
  return {
    splitRatio: 0.5,
    isDragging: false,
    containerRef: { current: null },
    onDividerMouseDown: vi.fn(),
    onDividerDoubleClick: vi.fn(),
    adjustRatio: vi.fn(),
    isNarrowScreen,
  };
}

beforeEach(() => {
  useAgentsMock.mockReset();
  useResponsiveLayoutMock.mockReset();
  useSplitPaneMock.mockReset();
  useAgentsMock.mockReturnValue({
    agents: [agent("claude:abc", "/p/alpha")],
    attentionCount: 0,
    loading: false,
    refresh: vi.fn(),
  });
  useResponsiveLayoutMock.mockReturnValue(responsive());
  useSplitPaneMock.mockReturnValue(splitPane(false));
});

describe("App — persistent R panel layout", () => {
  it("shows the digest in the centre AND the R panel on the right with no selection", () => {
    renderWithProviders(<App initialConsoleMode="producer" />);
    expect(screen.getByTestId("producer-console-stub")).toBeTruthy();
    expect(screen.getByTestId("r-panel-stub")).toBeTruthy();
  });

  it("keeps the R panel co-visible after an agent is selected (centre swaps, R stays)", () => {
    renderWithProviders(<App initialConsoleMode="producer" />);

    const agentBtn = screen.getByTitle("claude:abc");
    fireEvent.click(agentBtn);

    expect(screen.queryByTestId("producer-console-stub")).toBeNull();
    expect(screen.getByTestId("preview-stub")).toBeTruthy();
    expect(screen.getByTestId("r-panel-stub")).toBeTruthy();
  });

  it("hides the R panel on a narrow viewport (isNarrowScreen from useSplitPane)", () => {
    useResponsiveLayoutMock.mockReturnValue(responsive({ isNarrowScreen: true }));
    useSplitPaneMock.mockReturnValue(splitPane(true));

    renderWithProviders(<App initialConsoleMode="producer" />);

    expect(screen.queryByTestId("r-panel-stub")).toBeNull();
  });

  it("hides the R panel on mobile", () => {
    useResponsiveLayoutMock.mockReturnValue(responsive({ isMobileScreen: true }));

    renderWithProviders(<App initialConsoleMode="producer" />);

    expect(screen.queryByTestId("r-panel-stub")).toBeNull();
  });

  it("re-scopes the focused unit on a cross-unit click (no full-screen view)", () => {
    useAgentsMock.mockReturnValue({
      agents: [agent("claude:abc", "/p/alpha"), agent("claude:def", "/p/beta")],
      attentionCount: 0,
      loading: false,
      refresh: vi.fn(),
    });

    renderWithProviders(<App initialConsoleMode="producer" />);

    expect(screen.getByTestId("console-current-project").textContent).toBe("/p/alpha");

    fireEvent.click(screen.getByText("rescope-beta"));

    expect(screen.getByTestId("console-current-project").textContent).toBe("/p/beta");
    expect(screen.getByTestId("producer-console-stub")).toBeTruthy();
  });

  it("focus mode: a focus renders the viewer INSIDE the single R panel column (no additive sibling)", () => {
    renderWithProviders(<App initialConsoleMode="producer" />);

    // No focus yet → no viewer anywhere.
    expect(screen.queryByTestId("r-pr-viewer-stub")).toBeNull();

    // Focus a PR from the (stubbed) inventory.
    fireEvent.click(screen.getByText("focus-pr"));

    // The viewer renders, and it lives INSIDE the single R panel column —
    // it was handed in as RPanel's `viewer`, not rendered as a separate
    // fourth column that would steal width from the centre. (C-width
    // invariant, asserted structurally per the brief.)
    const panel = screen.getByTestId("r-panel-stub");
    expect(within(panel).getByTestId("r-pr-viewer-stub")).toBeTruthy();
    // Exactly one viewer in the whole tree — focus mode toggles, never stacks.
    expect(screen.getAllByTestId("r-pr-viewer-stub")).toHaveLength(1);
  });

  it("focus mode: the ‹ Inventory back affordance clears the focus (returns to inventory)", () => {
    renderWithProviders(<App initialConsoleMode="producer" />);

    fireEvent.click(screen.getByText("focus-pr"));
    expect(screen.getByTestId("r-pr-viewer-stub")).toBeTruthy();

    // The viewer's close (‹ Inventory) is wired to App's clearPr → focus
    // clears → the column swaps back to the inventory (viewer unmounts).
    fireEvent.click(screen.getByText("back-to-inventory"));
    expect(screen.queryByTestId("r-pr-viewer-stub")).toBeNull();
    // The R panel column itself is still present (it never left).
    expect(screen.getByTestId("r-panel-stub")).toBeTruthy();
  });
});
