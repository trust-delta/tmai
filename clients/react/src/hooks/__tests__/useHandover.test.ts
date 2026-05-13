// @vitest-environment jsdom
//
// Aggregation tests for the Producer console's hand-over digest.
//
// We mock `useAgents` and `useWorktrees` directly so the test exercises
// `useHandover`'s composition logic (project grouping, attention
// filtering, state-pill derivation) without spinning up SSEProvider.

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSnapshot, WorktreeSnapshot } from "@/lib/api";
import { useHandover } from "../useHandover";

const useAgentsMock = vi.fn();
const useWorktreesMock = vi.fn();

vi.mock("@/hooks/useAgents", () => ({
  useAgents: () => useAgentsMock(),
}));

vi.mock("@/hooks/useWorktrees", () => ({
  useWorktrees: () => useWorktreesMock(),
}));

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

beforeEach(() => {
  useAgentsMock.mockReset();
  useWorktreesMock.mockReset();
  useAgentsMock.mockReturnValue({
    agents: [],
    attentionCount: 0,
    loading: false,
    refresh: vi.fn(),
  });
  useWorktreesMock.mockReturnValue({
    worktrees: [] as WorktreeSnapshot[],
    loading: false,
    refresh: vi.fn(),
  });
});

describe("useHandover — empty state", () => {
  it("returns empty WhereYouLeftOff when no project is scoped", () => {
    const { result } = renderHook(() => useHandover(null));
    expect(result.current.whereYouLeftOff.activeProjectPath).toBeNull();
    expect(result.current.whereYouLeftOff.activeProjectName).toBeNull();
    expect(result.current.whereYouLeftOff.worktrees).toEqual([]);
    expect(result.current.whereYouLeftOff.attentionAgents).toEqual([]);
  });

  it("returns empty crossUnit list when no agents are running", () => {
    const { result } = renderHook(() => useHandover(null));
    expect(result.current.crossUnit.units).toEqual([]);
  });

  it("always exposes the two Phase-C placeholders", () => {
    const { result } = renderHook(() => useHandover(null));
    expect(result.current.settledDecisions.placeholder).toBe(true);
    expect(result.current.settledDecisions.reason).toMatch(/Phase C/);
    expect(result.current.workingWithHuman.placeholder).toBe(true);
    expect(result.current.workingWithHuman.reason).toMatch(/Phase C/);
  });
});

describe("useHandover — WhereYouLeftOff scoping", () => {
  it("returns the active project's name and its worktrees when scoped", () => {
    useAgentsMock.mockReturnValue({
      agents: [
        agent({ id: "a1", cwd: "/home/u/proj-a", git_common_dir: "/home/u/proj-a/.git" }),
        agent({ id: "a2", cwd: "/home/u/proj-b", git_common_dir: "/home/u/proj-b/.git" }),
      ],
      attentionCount: 0,
      loading: false,
      refresh: vi.fn(),
    });

    const { result } = renderHook(() => useHandover("/home/u/proj-a"));
    expect(result.current.whereYouLeftOff.activeProjectName).toBe("proj-a");
    expect(result.current.whereYouLeftOff.worktrees).toHaveLength(1);
    expect(result.current.whereYouLeftOff.worktrees[0]?.isMain).toBe(true);
  });

  it("only surfaces attention agents on the scoped project", () => {
    useAgentsMock.mockReturnValue({
      agents: [
        agent({
          id: "a-need",
          cwd: "/home/u/proj-a",
          git_common_dir: "/home/u/proj-a/.git",
          attention: "halted",
          display_name: "needs-attention",
        }),
        agent({
          id: "b-need",
          cwd: "/home/u/proj-b",
          git_common_dir: "/home/u/proj-b/.git",
          attention: "halted",
          display_name: "other-needs",
        }),
        agent({
          id: "a-quiet",
          cwd: "/home/u/proj-a",
          git_common_dir: "/home/u/proj-a/.git",
        }),
      ],
      attentionCount: 2,
      loading: false,
      refresh: vi.fn(),
    });

    const { result } = renderHook(() => useHandover("/home/u/proj-a"));
    const names = result.current.whereYouLeftOff.attentionAgents.map((a) => a.displayName);
    expect(names).toContain("needs-attention");
    expect(names).not.toContain("other-needs");
  });

  it("falls back to all attention agents when no project is scoped", () => {
    useAgentsMock.mockReturnValue({
      agents: [
        agent({
          id: "a-need",
          cwd: "/home/u/proj-a",
          git_common_dir: "/home/u/proj-a/.git",
          attention: "halted",
          display_name: "alpha",
        }),
        agent({
          id: "b-need",
          cwd: "/home/u/proj-b",
          git_common_dir: "/home/u/proj-b/.git",
          attention: "halted",
          display_name: "beta",
        }),
      ],
      attentionCount: 2,
      loading: false,
      refresh: vi.fn(),
    });

    const { result } = renderHook(() => useHandover(null));
    const names = result.current.whereYouLeftOff.attentionAgents.map((a) => a.displayName);
    expect(names).toEqual(expect.arrayContaining(["alpha", "beta"]));
  });
});

describe("useHandover — crossUnit derivation", () => {
  it("flags a unit as needs-you when any agent has non-null attention", () => {
    useAgentsMock.mockReturnValue({
      agents: [
        agent({
          id: "a1",
          cwd: "/home/u/proj-a",
          git_common_dir: "/home/u/proj-a/.git",
          attention: "halted",
        }),
      ],
      attentionCount: 1,
      loading: false,
      refresh: vi.fn(),
    });

    const { result } = renderHook(() => useHandover(null));
    expect(result.current.crossUnit.units).toHaveLength(1);
    expect(result.current.crossUnit.units[0]?.state).toBe("needs-you");
    expect(result.current.crossUnit.units[0]?.attentionCount).toBe(1);
  });

  it("flags a unit as in-progress when agents present but none attention", () => {
    useAgentsMock.mockReturnValue({
      agents: [agent({ id: "a1", cwd: "/home/u/proj-a", git_common_dir: "/home/u/proj-a/.git" })],
      attentionCount: 0,
      loading: false,
      refresh: vi.fn(),
    });

    const { result } = renderHook(() => useHandover(null));
    expect(result.current.crossUnit.units[0]?.state).toBe("in-progress");
  });

  it("dedupes units by git_common_dir so siblings sharing a repo collapse", () => {
    useAgentsMock.mockReturnValue({
      agents: [
        agent({ id: "a1", cwd: "/home/u/proj-a", git_common_dir: "/home/u/proj-a/.git" }),
        agent({ id: "a2", cwd: "/home/u/proj-a", git_common_dir: "/home/u/proj-a/.git" }),
      ],
      attentionCount: 0,
      loading: false,
      refresh: vi.fn(),
    });

    const { result } = renderHook(() => useHandover(null));
    expect(result.current.crossUnit.units).toHaveLength(1);
    expect(result.current.crossUnit.units[0]?.agentCount).toBe(2);
  });
});
