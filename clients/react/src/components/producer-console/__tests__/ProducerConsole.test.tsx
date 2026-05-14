// @vitest-environment jsdom
//
// ProducerConsole composition tests.
//
// We mock `useHandover` so each render can present a deterministic
// digest shape and we can assert on what the four sections actually
// surface (headers, placeholders, attention rows). NewAgentLauncher
// is also mocked because the operator-override panel embeds it.

import { render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HandoverDigest } from "@/hooks/useHandover";
import { ProducerConsole } from "../ProducerConsole";

const useHandoverMock = vi.fn();

vi.mock("@/hooks/useHandover", () => ({
  useHandover: (path: string | null) => useHandoverMock(path),
}));

vi.mock("@/components/project/NewAgentLauncher", () => ({
  NewAgentLauncher: () => <div data-testid="mock-new-agent-launcher">[mocked]</div>,
}));

// ProducerConsole reads the live agent list to forward into the new
// Handoff & restart filter. Stub `useAgents` so the test can stay
// SSEProvider-free.
vi.mock("@/hooks/useAgents", () => ({
  useAgents: () => ({ agents: [], attentionCount: 0, loading: false, refresh: vi.fn() }),
}));

// `useHandoffRitual` lives inside ProducerConsoleActions and registers
// with useSSE — stub so it's a no-op in these composition tests.
vi.mock("@/lib/sse-provider", () => ({
  useSSE: vi.fn(),
}));

// `useHandoffRitual`'s API mock — only the trigger callable matters
// here since the composition tests never fire the handoff ritual.
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      getGeneralSettings: vi.fn().mockResolvedValue({ default_project_root: null }),
      killAgent: vi.fn().mockResolvedValue(undefined),
      triggerHandoffRitual: vi.fn().mockResolvedValue({ ritual_id: "r-stub" }),
    },
  };
});

function digest(overrides: Partial<HandoverDigest> = {}): HandoverDigest {
  return {
    whereYouLeftOff: overrides.whereYouLeftOff ?? {
      activeProjectPath: null,
      activeProjectName: null,
      worktrees: [],
      attentionAgents: [],
    },
    crossUnit: overrides.crossUnit ?? { units: [] },
    settledDecisions: overrides.settledDecisions ?? { placeholder: true },
    workingWithHuman: overrides.workingWithHuman ?? { placeholder: true },
    missingPreconditions: overrides.missingPreconditions ?? {
      noLiveAgents: true,
      singleUnitOnly: false,
    },
  };
}

// Common prop bag — keeps each render() call short and lets us
// override only the fields a given test cares about.
function makeProps(
  overrides: Partial<ComponentProps<typeof ProducerConsole>> = {},
): ComponentProps<typeof ProducerConsole> {
  return {
    currentProjectPath: null,
    unitName: null,
    calibrationData: null,
    onOpenProducerTerminal: vi.fn(),
    onLaunchProducerAt: vi.fn(),
    onOpenCalibration: vi.fn(),
    onSelectProjectByPath: vi.fn(),
    onOverrideSpawned: vi.fn(),
    onOpenSidebar: vi.fn(),
    sidebarCollapsed: false,
    onOpenSettings: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  useHandoverMock.mockReset();
});

describe("ProducerConsole", () => {
  it("renders the four hand-over section headers", () => {
    useHandoverMock.mockReturnValue(digest());

    render(<ProducerConsole {...makeProps()} />);

    expect(screen.getByRole("heading", { name: /Welcome to tmai/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Where you left off/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Cross-unit status/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Settled decisions/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Working with this human/ })).toBeTruthy();
  });

  it("shows the no-project hint when nothing is scoped", () => {
    useHandoverMock.mockReturnValue(digest());

    render(<ProducerConsole {...makeProps()} />);

    expect(screen.getByText(/No project scoped yet/i)).toBeTruthy();
  });

  it("renders attention agents when present on the scoped project", () => {
    useHandoverMock.mockReturnValue(
      digest({
        whereYouLeftOff: {
          activeProjectPath: "/p/a",
          activeProjectName: "a",
          worktrees: [
            {
              name: "main",
              branch: "main",
              path: "/p/a",
              isMain: true,
              dirty: false,
              agentCount: 1,
            },
          ],
          attentionAgents: [
            {
              target: "claude:1",
              displayName: "halted-agent",
              attention: "halted",
              cwd: "/p/a",
              isOrchestrator: false,
            },
          ],
        },
      }),
    );

    render(<ProducerConsole {...makeProps({ currentProjectPath: "/p/a", unitName: "a" })} />);

    expect(screen.getByText("halted-agent")).toBeTruthy();
    expect(screen.getByText("main")).toBeTruthy();
  });

  it("renders the user-facing copy in the not-yet-wired sections", () => {
    useHandoverMock.mockReturnValue(digest());

    render(<ProducerConsole {...makeProps()} />);

    // Section components own these strings (not the hook); they should
    // point the operator at the repo-side fallbacks rather than leak
    // phase-tracking jargon ("Phase C: ... not yet wired") which read
    // as broken on first contact.
    expect(screen.getByText(/doc\/decisions/)).toBeTruthy();
    expect(screen.getByText(/CLAUDE\.md/)).toBeTruthy();
  });

  it("renders cross-unit rows and routes click to onSelectProjectByPath", () => {
    const onSelect = vi.fn();
    useHandoverMock.mockReturnValue(
      digest({
        crossUnit: {
          units: [
            {
              path: "/p/alpha",
              name: "alpha",
              state: "needs-you",
              agentCount: 2,
              attentionCount: 1,
            },
            {
              path: "/p/beta",
              name: "beta",
              state: "quiet",
              agentCount: 0,
              attentionCount: 0,
            },
          ],
        },
      }),
    );

    const { container } = render(
      <ProducerConsole
        {...makeProps({
          currentProjectPath: "/p/alpha",
          unitName: "alpha",
          onSelectProjectByPath: onSelect,
        })}
      />,
    );
    expect(screen.getByText("alpha")).toBeTruthy();
    expect(screen.getByText("beta")).toBeTruthy();
    const betaButton = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("beta"),
    );
    expect(betaButton).toBeTruthy();
    betaButton?.click();
    expect(onSelect).toHaveBeenCalledWith("/p/beta", "beta");
  });

  it("shows the singleUnitOnly posture notice when missingPreconditions flags it", () => {
    // Per the simulated-onboarded posture DR, the WebUI is honest
    // about the multi-repo / dormant-unit wire gap (tmai-core#340)
    // by surfacing this notice in the ⬢ Cross-unit status section
    // whenever only one unit is derivable from live agents.
    useHandoverMock.mockReturnValue(
      digest({
        crossUnit: {
          units: [
            {
              path: "/p/alpha",
              name: "alpha",
              state: "in-progress",
              agentCount: 1,
              attentionCount: 0,
            },
          ],
        },
        missingPreconditions: { noLiveAgents: false, singleUnitOnly: true },
      }),
    );

    render(
      <ProducerConsole {...makeProps({ currentProjectPath: "/p/alpha", unitName: "alpha" })} />,
    );

    expect(screen.getByText(/Showing one unit only/i)).toBeTruthy();
  });

  it("omits the singleUnitOnly notice when more than one unit is derived", () => {
    useHandoverMock.mockReturnValue(
      digest({
        crossUnit: {
          units: [
            { path: "/p/a", name: "a", state: "in-progress", agentCount: 1, attentionCount: 0 },
            { path: "/p/b", name: "b", state: "quiet", agentCount: 0, attentionCount: 0 },
          ],
        },
        missingPreconditions: { noLiveAgents: false, singleUnitOnly: false },
      }),
    );

    render(<ProducerConsole {...makeProps()} />);

    expect(screen.queryByText(/Showing one unit only/i)).toBeNull();
  });
});
