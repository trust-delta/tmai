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

function digest(overrides: Partial<HandoverDigest> = {}): HandoverDigest {
  return {
    whereYouLeftOff: overrides.whereYouLeftOff ?? {
      activeProjectPath: null,
      activeProjectName: null,
      worktrees: [],
      attentionAgents: [],
    },
    crossUnit: overrides.crossUnit ?? { units: [] },
    settledDecisions: overrides.settledDecisions ?? {
      placeholder: true,
      reason: "PLACEHOLDER_DECISIONS_REASON",
    },
    workingWithHuman: overrides.workingWithHuman ?? {
      placeholder: true,
      reason: "PLACEHOLDER_HUMAN_REASON",
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

    expect(screen.getByRole("heading", { name: /Producer console/ })).toBeTruthy();
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

  it("surfaces the explicit Phase-C placeholder reason in both placeholder sections", () => {
    useHandoverMock.mockReturnValue(digest());

    render(<ProducerConsole {...makeProps()} />);

    expect(screen.getByText("PLACEHOLDER_DECISIONS_REASON")).toBeTruthy();
    expect(screen.getByText("PLACEHOLDER_HUMAN_REASON")).toBeTruthy();
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
});
