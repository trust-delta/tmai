// @vitest-environment jsdom
//
// App-level handoff-ritual wiring test. App owns the single `useHandoffRitual`
// instance and threads the in-progress overlay into the aim console's
// conversation panel via the `handoffOverlay` prop. The overlay must mount on
// the DEFAULT (and now SOLE) aim-console surface — regression #897: before the
// fix, App's aim-mode early return rendered only <AimConsole> and stranded the
// overlay in the since-removed producer-mode branch below it, so a handoff from
// the default surface showed nothing. `useHandoffRitual` is mocked so we can
// drive `state` deterministically; AimConsole is stubbed to render its
// `handoffOverlay` prop, and the overlay itself is the REAL component so we
// assert on its phase rows.

import { screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSnapshot } from "@/lib/api";
import { renderWithProviders } from "@/test/render";

// ── hook mocks ──
const useAgentsMock = vi.fn();
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
// Loaded-empty membership: `unitName` then resolves by basename of the synthetic
// `/p/...` paths these tests use (no live slot). Must be `loading: false` so
// App's slots-load gate releases `unitName`.
vi.mock("@/hooks/useSlots", () => ({
  useSlots: () => ({ data: { slots: [] }, loading: false, error: null }),
}));
vi.mock("@/hooks/useNotificationConfig", () => ({ useNotificationConfig: () => ({}) }));
vi.mock("@/hooks/useIdleNotification", () => ({
  useIdleNotification: () => ({ handleAgentStopped: vi.fn() }),
}));
vi.mock("@/hooks/useKeyboardShortcuts", () => ({ useKeyboardShortcuts: () => undefined }));
vi.mock("@/hooks/useHandoffRitual", () => ({ useHandoffRitual: () => useHandoffRitualMock() }));

// ── component stubs ──
vi.mock("@/components/settings/SettingsPanel", () => ({ SettingsPanel: () => null }));
vi.mock("@/components/project/ProducerLaunchPicker", () => ({
  ProducerLaunchPicker: () => null,
}));
// The aim console is the sole surface. Stub it so the test observes whether the
// handoff overlay mounts alongside it, without rendering the real 3-pane console
// (its own tests cover that). The in-progress overlay is threaded INTO the
// conversation panel via `handoffOverlay`, so the stub must render that prop
// (the real AimConsole places it inside its `.ac-session` column).
vi.mock("@/components/aim-console/AimConsole", () => ({
  AimConsole: ({ handoffOverlay }: { handoffOverlay?: ReactNode }) => (
    <div data-testid="aim-console-stub">aim-console{handoffOverlay}</div>
  ),
}));

import { App } from "@/App";

function agent(overrides: { id: string; cwd?: string }): AgentSnapshot {
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
    is_worktree: false,
    git_common_dir: "/p/alpha/.git",
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
  useHandoffRitualMock.mockReset();
  useHandoffRitualMock.mockReturnValue(idleRitual());
});

describe("App — handoff ritual wiring", () => {
  it("renders the handoff overlay in the aim-console surface (regression #897)", () => {
    // aim is the sole surface. Before #897, App's aim-mode early return rendered
    // only <AimConsole> and stranded the handoff overlay in the (now-removed)
    // producer-mode return below it, so a handoff from the default surface showed
    // nothing. The overlay is now threaded into the conversation panel via
    // `handoffOverlay` (the real AimConsole places it in `.ac-session`; this stub
    // renders the prop).
    useAgentsMock.mockReturnValue({
      agents: [agent({ id: "claude:prod" })],
      attentionCount: 0,
      loading: false,
      refresh: vi.fn(),
    });
    useHandoffRitualMock.mockReturnValue({
      ...idleRitual(),
      state: { kind: "in_progress", ritualId: "r-1", unit: "alpha", phases: [] },
    });

    renderWithProviders(<App />);

    // The aim console is the sole surface …
    expect(screen.getByTestId("aim-console-stub")).toBeTruthy();
    // … and the handoff overlay is co-visible with it (via `handoffOverlay`).
    expect(screen.getByTestId("phase-row-prompted")).toBeTruthy();
  });
});
