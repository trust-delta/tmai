// @vitest-environment jsdom
//
// App-level handoff-ritual wiring test. After the ritual was lifted out
// of the digest-only ProducerConsoleActions up to App
// (`doc/decisions/2026-05-14-react-producer-console-rebuild.md` — the
// L/C/R co-visible principle; lived friction 2026-05-23), App owns the
// single `useHandoffRitual` instance and is responsible for:
//
//   1. mounting <ProducerConversationHeader> ABOVE the conversation ONLY
//      when the selected agent IS the unit's Producer (not for workers);
//   2. rendering the in-progress overlay at App level so it stays
//      co-visible with ANY centre view — including the conversation that
//      previously couldn't reach it.
//
// We stub the conversation header (its content is covered by its own
// test) and observe the App gate via the stub's presence; the overlay is
// the REAL component so we assert on its phase rows. `useHandoffRitual`
// is mocked so we can drive `state` deterministically.

import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSnapshot } from "@/lib/api";
import { renderWithProviders } from "@/test/render";

// ── hook mocks ──
const useAgentsMock = vi.fn();
const useResponsiveLayoutMock = vi.fn();
const useSplitPaneMock = vi.fn();
const useHandoffRitualMock = vi.fn();

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
vi.mock("@/hooks/useHandoffRitual", () => ({ useHandoffRitual: () => useHandoffRitualMock() }));

// ── component stubs ──
vi.mock("@/components/producer-console/r-panel/RPanel", () => ({
  RPanel: () => <div data-testid="r-panel-stub">r-panel</div>,
}));
vi.mock("@/hooks/useProducerFeed", () => ({
  useProducerFeed: () => ({ data: null, loading: false, error: null }),
}));
vi.mock("@/components/producer-console/ProducerConsole", () => ({
  ProducerConsole: () => <div data-testid="producer-console-stub">digest</div>,
}));
// Stub the conversation header so the App gate
// (`selectedAgent.id === producerForUnit?.id`) is observable without
// rendering the real ctx readout (which fetches orchestrator settings).
vi.mock("@/components/producer-console/ProducerConversationHeader", () => ({
  ProducerConversationHeader: () => (
    <div data-testid="conversation-header-stub">conversation-header</div>
  ),
}));
vi.mock("@/components/agent/PreviewPanel", () => ({
  PreviewPanel: () => <div data-testid="preview-stub">preview</div>,
}));
// Observable stub so we can assert the Producer conversation renders the
// MERGED bar (no separate AgentActions) while a worker still gets one.
vi.mock("@/components/agent/AgentActions", () => ({
  AgentActions: () => <div data-testid="agent-actions-stub">actions</div>,
}));
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

function agent(overrides: {
  id: string;
  cwd?: string;
  gitCommonDir?: string | null;
  isWorktree?: boolean;
}): AgentSnapshot {
  const id = overrides.id;
  const cwd = overrides.cwd ?? "/p/alpha";
  return {
    id,
    target: id,
    agent_type: "ClaudeCode",
    title: id,
    cwd,
    display_cwd: cwd,
    display_name: id,
    detection_source: "HttpHook",
    git_branch: null,
    git_dirty: null,
    is_worktree: overrides.isWorktree ?? false,
    git_common_dir: overrides.gitCommonDir === undefined ? "/p/alpha/.git" : overrides.gitCommonDir,
    worktree_name: overrides.isWorktree ? "feat-x" : null,
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

function idleRitual() {
  return {
    state: { kind: "idle" as const },
    trigger: vi.fn(),
    retry: vi.fn(),
    dismiss: vi.fn(),
    retryCount: 0,
    retryRefused: false,
  };
}

beforeEach(() => {
  useAgentsMock.mockReset();
  useResponsiveLayoutMock.mockReset();
  useSplitPaneMock.mockReset();
  useHandoffRitualMock.mockReset();
  useResponsiveLayoutMock.mockReturnValue(responsive());
  useSplitPaneMock.mockReturnValue(splitPane(false));
  useHandoffRitualMock.mockReturnValue(idleRitual());
});

describe("App — handoff ritual wiring", () => {
  it("mounts the conversation header when the selected agent IS the unit's Producer", () => {
    useAgentsMock.mockReturnValue({
      agents: [agent({ id: "claude:prod" })],
      attentionCount: 0,
      loading: false,
      refresh: vi.fn(),
    });

    renderWithProviders(<App />);

    // No selection yet → digest, no conversation header.
    expect(screen.queryByTestId("conversation-header-stub")).toBeNull();

    // Select the Producer (collapsed sidebar renders one button per agent).
    fireEvent.click(screen.getByTitle("claude:prod"));

    expect(screen.getByTestId("preview-stub")).toBeTruthy();
    expect(screen.getByTestId("conversation-header-stub")).toBeTruthy();
    // The merged bar subsumes AgentActions for the Producer — no separate
    // AgentActions bar (density refinement 2026-05-23).
    expect(screen.queryByTestId("agent-actions-stub")).toBeNull();
  });

  it("does NOT mount the conversation header when the selected agent is a worker", () => {
    // A non-worktree Producer + a worktree worker, both under /p/alpha.
    // The unit's Producer resolves to the non-worktree one; selecting the
    // worktree worker must leave the header unmounted.
    useAgentsMock.mockReturnValue({
      agents: [
        agent({ id: "claude:prod", cwd: "/p/alpha", isWorktree: false }),
        agent({ id: "claude:work", cwd: "/p/alpha/.worktrees/feat-x", isWorktree: true }),
      ],
      attentionCount: 0,
      loading: false,
      refresh: vi.fn(),
    });

    renderWithProviders(<App />);

    fireEvent.click(screen.getByTitle("claude:work"));

    expect(screen.getByTestId("preview-stub")).toBeTruthy();
    expect(screen.queryByTestId("conversation-header-stub")).toBeNull();
    // A worker keeps the plain AgentActions bar UNCHANGED.
    expect(screen.getByTestId("agent-actions-stub")).toBeTruthy();
  });

  it("renders the in-progress overlay at App level — co-visible with the conversation view", () => {
    useAgentsMock.mockReturnValue({
      agents: [agent({ id: "claude:prod" })],
      attentionCount: 0,
      loading: false,
      refresh: vi.fn(),
    });
    useHandoffRitualMock.mockReturnValue({
      ...idleRitual(),
      state: { kind: "in_progress", ritualId: "r-1", phases: [] },
    });

    renderWithProviders(<App />);

    // Overlay is present in the digest view …
    expect(screen.getByTestId("phase-row-prompted")).toBeTruthy();

    // … and STILL present after switching to the Producer conversation —
    // the trap that forced manual-kill (overlay only in the digest) is gone.
    fireEvent.click(screen.getByTitle("claude:prod"));
    expect(screen.getByTestId("preview-stub")).toBeTruthy();
    expect(screen.getByTestId("phase-row-prompted")).toBeTruthy();
  });
});
