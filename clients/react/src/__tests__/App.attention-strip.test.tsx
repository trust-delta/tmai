// @vitest-environment jsdom
//
// App layout test for the L/C/R co-visible re-layout
// (`doc/decisions/2026-05-14-react-producer-console-rebuild.md`
// §Refinement 2026-05-22 + P2 Fork B single-pane retire). This is a
// *layout* test: it asserts WHERE the AttentionStrip sits in App's flex
// tree and WHEN it shows — not the strip's internals (those are covered by
// AttentionStrip.test.tsx). So we stub the strip (and every heavy panel)
// and drive App's selection / breakpoint state through mocked hooks.
//
// The load-bearing assertions:
//   1. with no agent selected, the centre shows the digest AND the strip
//      is present;
//   2. after selecting an agent the centre swaps to the SINGLE-PANE agent
//      view (no git/docs tabs/split) but the strip STAYS present —
//      co-visibility kills the digest↔conversation screen-switch;
//   3. on a narrow viewport the strip is gone — its guard reads
//      isNarrowScreen off the sole surviving useSplitPane (Catch 1);
//   4. a cross-unit click re-scopes currentProject instead of opening a
//      removed full-screen view (Catch 2).

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
vi.mock("@/hooks/useSplitPane", () => ({ useSplitPane: () => useSplitPaneMock() }));
vi.mock("@/hooks/useAgentSelectionFallback", () => ({
  useAgentSelectionFallback: () => undefined,
}));
vi.mock("@/hooks/useKeyboardShortcuts", () => ({ useKeyboardShortcuts: () => undefined }));

// ── component stubs (everything heavy / networked) ──
vi.mock("@/components/producer-console/AttentionStrip", () => ({
  AttentionStrip: () => <div data-testid="attention-strip-stub">strip</div>,
}));
// The console stub surfaces `currentProjectPath` and a button that fires
// `onSelectProjectByPath`, so the cross-unit re-scope reroute (Catch 2 /
// DR §Refinement 2026-05-22 Fork B) is observable at the App level without
// rendering the real digest.
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
    is_orchestrator: false,
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

describe("App — persistent attention strip layout", () => {
  it("shows the digest in the centre AND the strip on the right with no selection", () => {
    renderWithProviders(<App />);
    expect(screen.getByTestId("producer-console-stub")).toBeTruthy();
    expect(screen.getByTestId("attention-strip-stub")).toBeTruthy();
  });

  it("keeps the strip co-visible after an agent is selected (centre swaps, strip stays)", () => {
    renderWithProviders(<App />);

    // Collapsed sidebar renders one button per AI agent (title = target).
    const agentBtn = screen.getByTitle("claude:abc");
    fireEvent.click(agentBtn);

    // Centre swapped away from the digest to the agent conversation …
    expect(screen.queryByTestId("producer-console-stub")).toBeNull();
    expect(screen.getByTestId("preview-stub")).toBeTruthy();
    // … and the attention strip is STILL there — no screen-switch.
    expect(screen.getByTestId("attention-strip-stub")).toBeTruthy();
  });

  it("hides the strip on a narrow viewport (isNarrowScreen from useSplitPane)", () => {
    // Catch 1: after the multipane retired, isNarrowScreen is sourced from
    // the sole surviving useSplitPane instance — the strip's narrow-hide
    // guard must still fire off it.
    useResponsiveLayoutMock.mockReturnValue(responsive({ isNarrowScreen: true }));
    useSplitPaneMock.mockReturnValue(splitPane(true));

    renderWithProviders(<App />);

    expect(screen.queryByTestId("attention-strip-stub")).toBeNull();
  });

  it("hides the strip on mobile", () => {
    useResponsiveLayoutMock.mockReturnValue(responsive({ isMobileScreen: true }));

    renderWithProviders(<App />);

    expect(screen.queryByTestId("attention-strip-stub")).toBeNull();
  });

  it("re-scopes the focused unit on a cross-unit click (no full-screen view)", () => {
    // Catch 2 / DR §Refinement 2026-05-22 Fork B: the full-screen project /
    // BranchGraph view retired, so a cross-unit click must RE-SCOPE
    // currentProject rather than open a removed view. Two agents → two
    // units, so the clicked path differs from the auto-defaulted one yet is
    // still in projectPaths (the auto-default effect won't reset it).
    useAgentsMock.mockReturnValue({
      agents: [agent("claude:abc", "/p/alpha"), agent("claude:def", "/p/beta")],
      attentionCount: 0,
      loading: false,
      refresh: vi.fn(),
    });

    renderWithProviders(<App />);

    // Auto-defaults to the first derived project (alpha sorts before beta).
    expect(screen.getByTestId("console-current-project").textContent).toBe("/p/alpha");

    fireEvent.click(screen.getByText("rescope-beta"));

    // Re-scoped to the clicked unit — and the digest is STILL shown (no
    // full-screen swap to a removed project view, no dead-end).
    expect(screen.getByTestId("console-current-project").textContent).toBe("/p/beta");
    expect(screen.getByTestId("producer-console-stub")).toBeTruthy();
  });
});
