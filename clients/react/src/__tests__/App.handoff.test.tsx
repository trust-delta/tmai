// @vitest-environment jsdom
//
// App-level handoff-ritual wiring test. App owns the single `useHandoffRitual`
// instance and threads the in-progress overlay into the aim console's
// conversation panel via the `handoffOverlay` prop. The overlay must mount on
// the DEFAULT (and now SOLE) aim-console surface — regression #897: before the
// fix, App's aim-mode early return rendered only <AimConsole> and stranded the
// overlay in the since-removed producer-mode branch below it, so a handoff from
// the default surface showed nothing. `useHandoffRitual` is mocked so we can
// drive `states` deterministically; AimConsole is stubbed to render its
// `handoffOverlay` prop, and the overlay itself is the REAL component so we
// assert on its phase rows.

import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RitualUiState } from "@/hooks/useHandoffRitual";
import { type AgentSnapshot, api } from "@/lib/api";
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
    // Ritual UI state keyed per unit (absent key == idle). Empty == all idle.
    states: {} as Record<string, RitualUiState>,
    // Per-unit latest handoff phase (cross-unit owed tab signal). Empty here —
    // this file exercises the overlay, not the tab dots.
    unitPhases: {},
    trigger: vi.fn(),
    retry: vi.fn(),
    dismiss: vi.fn(),
    // Retry budget keyed per unit (absent key == 0 / false).
    retryCount: {} as Record<string, number>,
    retryRefused: {} as Record<string, boolean>,
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
      states: { alpha: { kind: "in_progress", ritualId: "r-1", unit: "alpha", phases: [] } },
    });

    renderWithProviders(<App />);

    // The aim console is the sole surface …
    expect(screen.getByTestId("aim-console-stub")).toBeTruthy();
    // … and the handoff overlay is co-visible with it (via `handoffOverlay`).
    expect(screen.getByTestId("phase-row-prompted")).toBeTruthy();
  });

  // Regression for the #674 front-side facet (tmai-core #676). The in-progress
  // overlay reads `states[unitName]` (App.tsx `focusedRitual`), so it shows only
  // when the focused unit resolves to the ritual's own unit key. `unitName`
  // comes from `resolveUnitName(currentProject, slots)`; the ritual's unit key is
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
      states: { tmai: { kind: "in_progress", ritualId: "r-1", unit: "tmai", phases: [] } },
    });

    renderWithProviders(<App />);

    // `resolveUnitName("…/tmai-core", [TMAI_UNIT])` === "tmai" === ritual unit →
    // gate holds → overlay shows. A basename fallback ("tmai-core") would hide it.
    expect(screen.getByTestId("phase-row-prompted")).toBeTruthy();
  });

  // Cross-unit mis-kill guard (operator-reported 2026-07-15). A handoff
  // escalated for one unit; the failure dialog's Force-kill / Retry / Resume
  // must target the RITUAL unit, never the FOCUSED unit. The reported harm: a
  // failed handoff dropped its Producer from the live set, focus auto-bounced
  // to another unit, and Force-kill killed THAT (unopened) unit's Producer.
  it("disables Force-kill when the failed ritual's unit has no live Producer — never falls back to the focused unit (mis-kill guard)", () => {
    // `tmai` is the only live unit (so it is focused); the ritual escalated for
    // a DIFFERENT unit "gamma" whose Producer already left the live set.
    useSlotsMock.mockReturnValue({ data: { slots: [TMAI_UNIT] }, loading: false, error: null });
    useAgentsMock.mockReturnValue({
      agents: [
        {
          ...agent({ id: "claude:tmai-prod", cwd: "/home/u/works/tmai/tmai" }),
          is_producer: true,
          unit: "tmai",
        },
      ],
      attentionCount: 0,
      loading: false,
      refresh: vi.fn(),
    });
    useHandoffRitualMock.mockReturnValue({
      ...idleRitual(),
      states: {
        gamma: {
          kind: "escalated",
          ritualId: "r-1",
          unit: "gamma",
          reason: "handoff_timeout",
          message: null,
        },
      },
    });

    renderWithProviders(<App />);

    // The dialog is for unit "gamma" (gone) — Force-kill must be DISABLED, not
    // wired to tmai's Producer. (The buggy code enabled it, killing tmai.)
    const forceKill = screen.getByRole("button", { name: "Force kill" }) as HTMLButtonElement;
    expect(forceKill.disabled).toBe(true);
  });

  it("Force-kill targets the RITUAL unit's Producer, not the focused unit's", async () => {
    // Two live units. `groupByProject` orders by first-seen agent, so the
    // FOCUSED unit is whichever Producer is first — put "focused" first, then
    // escalate the ritual for the OTHER unit "gamma".
    const focusedProd = {
      ...agent({ id: "claude:focused-prod", cwd: "/p/focused" }),
      is_producer: true,
      unit: "focused",
    };
    const gammaProd = {
      ...agent({ id: "claude:gamma-prod", cwd: "/p/gamma" }),
      is_producer: true,
      unit: "gamma",
    };
    useSlotsMock.mockReturnValue({
      data: {
        slots: [
          { name: "focused", repos: [{ path: "/p/focused", primary: true }] },
          { name: "gamma", repos: [{ path: "/p/gamma", primary: true }] },
        ],
      },
      loading: false,
      error: null,
    });
    useAgentsMock.mockReturnValue({
      agents: [focusedProd, gammaProd], // focused first → it is the focused unit
      attentionCount: 0,
      loading: false,
      refresh: vi.fn(),
    });
    useHandoffRitualMock.mockReturnValue({
      ...idleRitual(),
      states: {
        gamma: {
          kind: "escalated",
          ritualId: "r-1",
          unit: "gamma",
          reason: "rejected",
          message: null,
        },
      },
    });
    const killSpy = vi.spyOn(api, "killAgent").mockResolvedValue(undefined);

    renderWithProviders(<App />);

    const forceKill = screen.getByRole("button", { name: "Force kill" }) as HTMLButtonElement;
    expect(forceKill.disabled).toBe(false);
    fireEvent.click(forceKill);

    await waitFor(() => expect(killSpy).toHaveBeenCalledWith("claude:gamma-prod"));
    expect(killSpy).not.toHaveBeenCalledWith("claude:focused-prod");
    killSpy.mockRestore();
  });
});
