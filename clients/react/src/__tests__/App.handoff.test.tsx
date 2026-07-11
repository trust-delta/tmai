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
import type { SlotResponse } from "@/types/generated/SlotResponse";

// ── hook mocks ──
const useAgentsMock = vi.fn();
const useHandoffRitualMock = vi.fn();
const useSlotsMock = vi.fn();

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
// Slot membership is per-test. The default (set in `beforeEach`) is loaded-empty
// so `unitName` resolves by basename of the synthetic `/p/...` paths most tests
// use (no live slot); the wrapper-unit regression below overrides it with a
// populated multi-repo unit. Must be `loading: false` so App's slots-load gate
// releases `unitName`.
vi.mock("@/hooks/useSlots", () => ({ useSlots: () => useSlotsMock() }));
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
    detection_source: "http_hook",
    git_branch: null,
    git_dirty: null,
    is_worktree: false,
    // Derive from cwd so a non-default cwd (the secondary-repo case below)
    // groups onto its OWN repo path, not a hardcoded `/p/alpha`.
    git_common_dir: `${cwd}/.git`,
    worktree_name: null,
    worktree_base_branch: null,
    effort_level: null,
    active_subagents: 0,
    compaction_count: 0,
    pty_session_id: null,
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

// The real multi-repo unit from #674: the Producer runs at the wrapper `…/tmai`,
// the unit "tmai" spans a primary repo (`…/tmai/tmai`, basename matches the unit
// name) and a SECONDARY repo (`…/tmai/tmai-core`, basename "tmai-core" does NOT).
// This is the post-#675 membership — the state the backend respawn now preserves.
const TMAI_UNIT: SlotResponse = {
  name: "tmai",
  repos: [
    { path: "/home/u/works/tmai/tmai", primary: true },
    { path: "/home/u/works/tmai/tmai-core", primary: false },
  ],
};

beforeEach(() => {
  useAgentsMock.mockReset();
  useHandoffRitualMock.mockReset();
  useHandoffRitualMock.mockReturnValue(idleRitual());
  useSlotsMock.mockReset();
  useSlotsMock.mockReturnValue({ data: { slots: [] }, loading: false, error: null });
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

  // Regression for the #674 front-side facet (tmai-core #676). The in-progress
  // overlay is gated by `ritualState.unit === unitName` (App.tsx). `unitName`
  // comes from `resolveUnitName(currentProject, slots)`; `ritualState.unit` is
  // server-authoritative off the SSE stream. #674's mismatch was the backend
  // respawning the Producer at the PRIMARY repo root, collapsing the unit's
  // membership so a SECONDARY-repo `currentProject` matched no slot →
  // `resolveUnitName` fell back to the basename "tmai-core" → it never equalled
  // the ritual's server unit "tmai" → the overlay stayed hidden and the ritual
  // stuck at `awaiting_review` (context loss, observed 2026-07-11). tmai-core
  // #675 restored the membership; this pins the FRONT-SIDE composition seam
  // #674 slipped through: with membership present and the focused unit's
  // `currentProject` on the SECONDARY repo, the gate must resolve the wrapper
  // unit and SHOW the overlay. The other case above uses empty slots + a
  // basename-matching path, so it never exercised this seam.
  it("shows the overlay for a wrapper unit whose currentProject is a SECONDARY repo (tmai-core #676)", () => {
    // Membership present (the post-#675 state the backend respawn now preserves).
    useSlotsMock.mockReturnValue({ data: { slots: [TMAI_UNIT] }, loading: false, error: null });
    // Sole agent sits on the SECONDARY repo → `currentProject` = `…/tmai-core`,
    // basename "tmai-core" ≠ the unit name "tmai".
    useAgentsMock.mockReturnValue({
      agents: [agent({ id: "claude:prod", cwd: "/home/u/works/tmai/tmai-core" })],
      attentionCount: 0,
      loading: false,
      refresh: vi.fn(),
    });
    // The ritual's server unit is the wrapper unit "tmai".
    useHandoffRitualMock.mockReturnValue({
      ...idleRitual(),
      state: { kind: "in_progress", ritualId: "r-1", unit: "tmai", phases: [] },
    });

    renderWithProviders(<App />);

    // `resolveUnitName("…/tmai-core", [TMAI_UNIT])` === "tmai" === ritual unit →
    // gate holds → overlay shows. A basename fallback ("tmai-core") would hide it.
    expect(screen.getByTestId("phase-row-prompted")).toBeTruthy();
  });
});
