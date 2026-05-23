// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AgentSnapshot } from "@/lib/api";

// Stub the per-unit group + spawn launcher: this suite asserts AgentList's
// own shell (retired legacy framing, spawn folded behind an Advanced
// disclosure), not the children's internals (covered by ProducerRoster /
// NewAgentLauncher suites).
vi.mock("@/components/project/ProjectGroup", () => ({
  ProjectGroup: ({ project }: { project: { name: string; path: string } }) => (
    <div data-testid="project-group">{project.name}</div>
  ),
}));
vi.mock("@/components/project/NewAgentLauncher", () => ({
  NewAgentLauncher: () => <div data-testid="new-agent-launcher">launcher</div>,
}));

const { AgentList } = await import("@/components/agent/AgentList");

function stubAgent(overrides: Partial<AgentSnapshot> = {}): AgentSnapshot {
  return {
    id: "claude:prod-1",
    target: "claude:prod-1",
    agent_type: "ClaudeCode",
    title: "",
    cwd: "/repo",
    display_cwd: "/repo",
    display_name: "claude:prod-1",
    detection_source: "HttpHook",
    git_branch: null,
    git_dirty: false,
    is_worktree: false,
    git_common_dir: "/repo/.git",
    worktree_name: null,
    worktree_base_branch: null,
    effort_level: null,
    active_subagents: 0,
    compaction_count: 0,
    pty_session_id: null,
    send_capability: "PtyInject",
    is_virtual: false,
    team_info: null,
    attention: null,
    ...overrides,
  };
}

describe("AgentList", () => {
  it("does not render the retired 'Operator view (legacy)' framing", () => {
    render(
      <AgentList
        agents={[stubAgent()]}
        loading={false}
        selection={null}
        onSelectAgent={() => {}}
        worktrees={[]}
        onSpawned={() => {}}
      />,
    );

    expect(screen.queryByText(/operator view \(legacy\)/i)).toBeNull();
    expect(screen.queryByText(/bypass the producer/i)).toBeNull();
  });

  it("renders one Producer-rooted group per unit, above the spawn footer", () => {
    render(
      <AgentList
        agents={[stubAgent()]}
        loading={false}
        selection={null}
        onSelectAgent={() => {}}
        worktrees={[]}
        onSpawned={() => {}}
      />,
    );

    const group = screen.getByTestId("project-group");
    const launcher = screen.getByTestId("new-agent-launcher");
    expect(group.textContent).toBe("repo");
    // The unit roster renders before the emergency spawn footer.
    expect(group.compareDocumentPosition(launcher) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("folds the spawn launcher behind a de-emphasized Advanced/emergency disclosure", () => {
    render(
      <AgentList
        agents={[stubAgent()]}
        loading={false}
        selection={null}
        onSelectAgent={() => {}}
        worktrees={[]}
        onSpawned={() => {}}
      />,
    );

    // The launcher is no longer a prominent top slot — it lives inside a
    // <details> disclosure whose <summary> is the emergency affordance.
    const summary = screen.getByText(/advanced — emergency spawn/i);
    expect(summary.tagName.toLowerCase()).toBe("summary");

    const launcher = screen.getByTestId("new-agent-launcher");
    const details = launcher.closest("details");
    expect(details).not.toBeNull();
    // Default-collapsed: the disclosure is not forced open.
    expect((details as HTMLDetailsElement).open).toBe(false);
  });

  it("shows an honest empty state when there are no agents", () => {
    render(
      <AgentList
        agents={[]}
        loading={false}
        selection={null}
        onSelectAgent={() => {}}
        worktrees={[]}
        onSpawned={() => {}}
      />,
    );

    expect(screen.queryByTestId("project-group")).toBeNull();
    expect(screen.getByText(/no agents yet/i)).toBeTruthy();
    // Even with no agents, the emergency spawn affordance is still reachable.
    expect(screen.getByText(/advanced — emergency spawn/i)).toBeTruthy();
  });

  it("renders an initializing state while loading", () => {
    render(
      <AgentList
        agents={[]}
        loading={true}
        selection={null}
        onSelectAgent={() => {}}
        worktrees={[]}
        onSpawned={() => {}}
      />,
    );

    expect(screen.getByText(/initializing/i)).toBeTruthy();
  });
});
