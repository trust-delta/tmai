// @vitest-environment jsdom
//
// App-level coexist-toggle wiring test (aim node
// `tmai-core:doc/aims/aim-ui.md`, S1). The StatusBar hosts a console-mode
// toggle; App holds the `consoleMode` sibling state. The contract:
//
//   1. DEFAULT is the full-window <AimConsole> — it is now the primary surface;
//   2. the aim console's own EXIT toggle returns to the legacy ProducerConsole
//      (the sidebar / digest / R panel reappear);
//   3. in producer mode the StatusBar toggle switches back to the aim console.
//
// The real <AimConsole> is covered by its own test; here it's stubbed so we
// observe WHICH top-level view App renders, plus the exit seam.

import { fireEvent, screen } from "@testing-library/react";
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
vi.mock("@/hooks/useUnits", () => ({
  useUnits: () => ({ data: { units: [] }, loading: false, error: null }),
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
vi.mock("@/components/producer-console/r-panel/RPanel", () => ({
  RPanel: () => <div data-testid="r-panel-stub">r-panel</div>,
}));
vi.mock("@/components/producer-console/r-panel/r-viewer/RPrViewer", () => ({
  RPrViewer: () => null,
  selectedPrKey: () => "pr-key",
}));
vi.mock("@/components/producer-console/r-panel/r-viewer/RRecordViewer", () => ({
  RRecordViewer: () => null,
  selectedRecordKey: () => "rec-key",
}));
vi.mock("@/components/producer-console/r-panel/r-viewer/RIssueViewer", () => ({
  RIssueViewer: () => null,
  selectedIssueKey: () => "iss-key",
}));
vi.mock("@/components/producer-console/ProducerConsole", () => ({
  ProducerConsole: () => <div data-testid="producer-console-stub">digest</div>,
}));
vi.mock("@/components/producer-console/ProducerConversationHeader", () => ({
  ProducerConversationHeader: () => null,
}));
vi.mock("@/components/agent/PreviewPanel", () => ({ PreviewPanel: () => null }));
vi.mock("@/components/agent/AgentActions", () => ({ AgentActions: () => null }));
vi.mock("@/components/terminal/TerminalPanel", () => ({ TerminalPanel: () => null }));
vi.mock("@/components/agent/AgentList", () => ({ AgentList: () => null }));
vi.mock("@/components/terminal/TerminalList", () => ({ TerminalList: () => null }));
vi.mock("@/components/usage/UsagePanel", () => ({ UsagePanel: () => null }));
vi.mock("@/components/settings/SettingsPanel", () => ({ SettingsPanel: () => null }));
vi.mock("@/components/settings/SecurityPanel", () => ({ SecurityPanel: () => null }));
vi.mock("@/components/calibration/CalibrationPanel", () => ({ CalibrationPanel: () => null }));

// The aim console is stubbed to a marker + an exit button wired to `onExit`,
// so we can observe the switch and the return path without rendering the
// real 3-pane shell.
vi.mock("@/components/aim-console/AimConsole", () => ({
  AimConsole: ({ onExit }: { onExit: () => void }) => (
    <div data-testid="aim-console-stub">
      <button type="button" onClick={onExit}>
        exit-aim
      </button>
    </div>
  ),
}));

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
    // Expanded sidebar so the StatusBar settings/toggle cluster renders.
    sidebarCollapsed: false,
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

describe("App — console-mode coexist toggle", () => {
  it("defaults to the aim console (now the primary surface)", () => {
    renderWithProviders(<App />);
    expect(screen.getByTestId("aim-console-stub")).toBeTruthy();
    expect(screen.queryByTestId("producer-console-stub")).toBeNull();
  });

  it("exits the aim console to the Producer console and back", () => {
    renderWithProviders(<App />);

    // Default is the full-window aim console — the existing shell (digest +
    // R panel) is replaced.
    expect(screen.getByTestId("aim-console-stub")).toBeTruthy();
    expect(screen.queryByTestId("producer-console-stub")).toBeNull();
    expect(screen.queryByTestId("r-panel-stub")).toBeNull();

    // Exit via the aim console's own toggle → the legacy Producer console.
    fireEvent.click(screen.getByText("exit-aim"));
    expect(screen.getByTestId("producer-console-stub")).toBeTruthy();
    expect(screen.queryByTestId("aim-console-stub")).toBeNull();

    // Re-enter via the StatusBar toggle → back to the aim console.
    fireEvent.click(screen.getByLabelText("Switch to the aim console (preview)"));
    expect(screen.getByTestId("aim-console-stub")).toBeTruthy();
    expect(screen.queryByTestId("producer-console-stub")).toBeNull();
  });
});
