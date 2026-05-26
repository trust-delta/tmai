// @vitest-environment jsdom
//
// ProducerConsoleActions — top row, operator-override expandable
// (Phase B), and DirBrowser-backed Producer launch when unit is
// unresolved (Phase B polish v3). NewAgentLauncher + DirBrowser
// + `api.getGeneralSettings` are mocked so we don't pull live
// network calls into render.

import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSnapshot, CalibrationResponse, ProducerFeedStatus } from "@/lib/api";
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

// `@/lib/api` exports both runtime helpers and `normalizeGitDir` —
// the shared `findProducerForUnit` resolver (`@/lib/producer`) calls
// `normalizeGitDir`, so we preserve the actual module and override only
// the `api` namespace. Only `getGeneralSettings` is exercised here now
// (the handoff ritual hook was lifted to App level — the button just
// calls the injected `trigger` prop).
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      getGeneralSettings: vi.fn().mockResolvedValue({ default_project_root: null }),
    },
  };
});

import type { ComponentProps } from "react";

function makeProps(
  overrides: Partial<ComponentProps<typeof ProducerConsoleActions>> = {},
): ComponentProps<typeof ProducerConsoleActions> {
  return {
    unitName: "u",
    currentProjectPath: null,
    agents: [],
    calibrationData: null,
    producerFeedData: null,
    onTriggerDeltaPull: vi.fn(),
    onOpenProducerTerminal: vi.fn(),
    onLaunchProducerAt: vi.fn(),
    onOpenCalibration: vi.fn(),
    trigger: vi.fn(),
    onOverrideSpawned: vi.fn(),
    onOpenSidebar: vi.fn(),
    sidebarCollapsed: false,
    onOpenSettings: vi.fn(),
    ...overrides,
  };
}

// Minimal AgentSnapshot factory — same defaults as `useHandover.test.ts`
// so the test fixtures stay aligned with the real wire shape.
function agent(partial: Partial<AgentSnapshot> & { id: string }): AgentSnapshot {
  return {
    id: partial.id,
    target: partial.target ?? partial.id,
    agent_type: partial.agent_type ?? "ClaudeCode",
    title: partial.title ?? partial.id,
    cwd: partial.cwd ?? "/home/u/proj",
    display_cwd: partial.display_cwd ?? "proj",
    display_name: partial.display_name ?? partial.id,
    detection_source: partial.detection_source ?? "IpcSocket",
    git_branch: partial.git_branch ?? "main",
    git_dirty: partial.git_dirty ?? false,
    is_worktree: partial.is_worktree ?? false,
    git_common_dir: partial.git_common_dir ?? "/home/u/proj/.git",
    worktree_name: partial.worktree_name ?? null,
    worktree_base_branch: partial.worktree_base_branch ?? null,
    effort_level: partial.effort_level ?? null,
    active_subagents: partial.active_subagents ?? 0,
    compaction_count: partial.compaction_count ?? 0,
    pty_session_id: partial.pty_session_id ?? null,
    send_capability: partial.send_capability ?? "Ipc",
    is_virtual: partial.is_virtual ?? false,
    team_info: partial.team_info ?? null,
    attention: partial.attention ?? null,
    is_orchestrator: partial.is_orchestrator,
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

function producerFeedFixture(overrides: Partial<ProducerFeedStatus> = {}): ProducerFeedStatus {
  return {
    unit: overrides.unit ?? "test-unit",
    producer_address: overrides.producer_address ?? "test-unit.producer",
    tip: overrides.tip ?? 0n,
    last_served_cursor: overrides.last_served_cursor ?? 0n,
    has_pending_delta: overrides.has_pending_delta,
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

describe("ProducerConsoleActions — Handoff & restart button", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Restore any `vi.spyOn(window, "confirm")` (and other spies) after each
  // test so a failing assertion can't leak the confirm stub into later tests.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is disabled when no Producer agent matches the unit", () => {
    render(<ProducerConsoleActions {...makeProps({ unitName: "tmai", agents: [] })} />);
    const btn = screen.getByRole("button", { name: /Handoff & restart/ });
    expect(btn).toHaveProperty("disabled", true);
  });

  it("is enabled when exactly one claude:-scheme non-worktree Producer exists at the unit path", () => {
    const producer = agent({
      id: "claude:abc-123",
      target: "claude:abc-123",
      cwd: "/home/u/proj-a",
      git_common_dir: "/home/u/proj-a/.git",
      is_worktree: false,
    });
    render(
      <ProducerConsoleActions
        {...makeProps({
          unitName: "proj-a",
          currentProjectPath: "/home/u/proj-a",
          agents: [producer],
        })}
      />,
    );
    const btn = screen.getByRole("button", { name: /Handoff & restart/ });
    expect(btn).toHaveProperty("disabled", false);
  });

  it("ignores worktree agents and stays disabled when only worktree agents exist", () => {
    const wtAgent = agent({
      id: "claude:abc-456",
      target: "claude:abc-456",
      cwd: "/home/u/proj-a/.worktrees/feat-x",
      git_common_dir: "/home/u/proj-a/.git",
      is_worktree: true,
      worktree_name: "feat-x",
    });
    render(
      <ProducerConsoleActions
        {...makeProps({
          unitName: "proj-a",
          currentProjectPath: "/home/u/proj-a",
          agents: [wtAgent],
        })}
      />,
    );
    const btn = screen.getByRole("button", { name: /Handoff & restart/ });
    expect(btn).toHaveProperty("disabled", true);
  });

  it("stays disabled when two Producers race the same unit (refuses to guess)", () => {
    const producerA = agent({
      id: "claude:a",
      cwd: "/home/u/proj-a",
      git_common_dir: "/home/u/proj-a/.git",
    });
    const producerB = agent({
      id: "claude:b",
      cwd: "/home/u/proj-a",
      git_common_dir: "/home/u/proj-a/.git",
    });
    render(
      <ProducerConsoleActions
        {...makeProps({
          unitName: "proj-a",
          currentProjectPath: "/home/u/proj-a",
          agents: [producerA, producerB],
        })}
      />,
    );
    const btn = screen.getByRole("button", { name: /Handoff & restart/ });
    expect(btn).toHaveProperty("disabled", true);
  });

  it("calls window.confirm and does NOT fire the trigger when confirmation is denied", () => {
    const trigger = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const producer = agent({
      id: "claude:abc-123",
      cwd: "/home/u/proj-a",
      git_common_dir: "/home/u/proj-a/.git",
    });
    render(
      <ProducerConsoleActions
        {...makeProps({
          unitName: "proj-a",
          currentProjectPath: "/home/u/proj-a",
          agents: [producer],
          trigger,
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Handoff & restart/ }));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(trigger).not.toHaveBeenCalled();
  });

  it("fires the lifted trigger prop when confirmation is accepted", () => {
    const trigger = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const producer = agent({
      id: "claude:abc-123",
      cwd: "/home/u/proj-a",
      git_common_dir: "/home/u/proj-a/.git",
    });
    render(
      <ProducerConsoleActions
        {...makeProps({
          unitName: "proj-a",
          currentProjectPath: "/home/u/proj-a",
          agents: [producer],
          trigger,
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Handoff & restart/ }));
    expect(trigger).toHaveBeenCalledWith("proj-a", { trigger: "manual" });
  });
});

describe("ProducerConsoleActions — Check deltas button", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // A live Producer at the unit's repo root — the gate also requires
  // this (matches the Handoff button's `findProducerForUnit` precedent).
  function liveProducer() {
    return agent({
      id: "claude:abc-123",
      cwd: "/home/u/proj-a",
      git_common_dir: "/home/u/proj-a/.git",
      is_worktree: false,
    });
  }

  it("is disabled when has_pending_delta is false/undefined even with a live Producer", () => {
    render(
      <ProducerConsoleActions
        {...makeProps({
          unitName: "proj-a",
          currentProjectPath: "/home/u/proj-a",
          agents: [liveProducer()],
          // `has_pending_delta` left undefined — absent on the wire ⇒ false.
          producerFeedData: producerFeedFixture(),
        })}
      />,
    );
    const btn = screen.getByRole("button", { name: /Check deltas/ });
    expect(btn).toHaveProperty("disabled", true);
  });

  it("is enabled when a live Producer exists AND has_pending_delta is true", () => {
    render(
      <ProducerConsoleActions
        {...makeProps({
          unitName: "proj-a",
          currentProjectPath: "/home/u/proj-a",
          agents: [liveProducer()],
          producerFeedData: producerFeedFixture({ has_pending_delta: true, tip: 3n }),
        })}
      />,
    );
    const btn = screen.getByRole("button", { name: /Check deltas/ });
    expect(btn).toHaveProperty("disabled", false);
  });

  it("stays disabled with a pending delta but no live Producer", () => {
    render(
      <ProducerConsoleActions
        {...makeProps({
          unitName: "proj-a",
          currentProjectPath: "/home/u/proj-a",
          agents: [],
          producerFeedData: producerFeedFixture({ has_pending_delta: true }),
        })}
      />,
    );
    const btn = screen.getByRole("button", { name: /Check deltas/ });
    expect(btn).toHaveProperty("disabled", true);
  });

  it("calls onTriggerDeltaPull with the unit name when the enabled button is clicked", () => {
    const onTriggerDeltaPull = vi.fn().mockResolvedValue(undefined);
    render(
      <ProducerConsoleActions
        {...makeProps({
          unitName: "proj-a",
          currentProjectPath: "/home/u/proj-a",
          agents: [liveProducer()],
          producerFeedData: producerFeedFixture({ has_pending_delta: true }),
          onTriggerDeltaPull,
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Check deltas/ }));
    expect(onTriggerDeltaPull).toHaveBeenCalledWith("proj-a");
  });
});
