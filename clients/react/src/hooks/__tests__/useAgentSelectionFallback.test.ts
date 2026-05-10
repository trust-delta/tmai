// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AgentSnapshot, Selection } from "@/lib/api-http";
import { useAgentSelectionFallback } from "../useAgentSelectionFallback";

// renderHook infers `initialProps`'s shape from the literal we pass in,
// so a concrete `selectedAgent: agent(...)` narrows it to `AgentSnapshot`
// and rejects the `selectedAgent: undefined` we pass to the death-case
// `rerender`. Annotating both `initialProps` and the callback param with
// these aliases keeps the death cases type-checkable without `as` casts.
type FallbackProps = {
  selectedAgent: AgentSnapshot | undefined;
  agents: AgentSnapshot[];
};
type FullFallbackProps = FallbackProps & { selection: Selection | null };

function agent(
  spec: Pick<AgentSnapshot, "target" | "cwd"> & Partial<Omit<AgentSnapshot, "target" | "cwd">>,
): AgentSnapshot {
  const { target, cwd, ...rest } = spec;
  return {
    id: target,
    target,
    agent_type: "Claude",
    title: target,
    cwd,
    display_cwd: cwd,
    display_name: target,
    detection_source: "Adopted",
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
    send_capability: "Unknown",
    is_virtual: false,
    team_info: null,
    is_orchestrator: false,
    attention: null,
    ...rest,
  } as AgentSnapshot;
}

describe("useAgentSelectionFallback", () => {
  it("does nothing while the selected agent is still in the list", () => {
    const setSelection = vi.fn();
    const a = agent({ target: "a", cwd: "/foo" });
    const selection: Selection = { type: "agent", id: "a" };
    renderHook(() =>
      useAgentSelectionFallback({
        selection,
        selectedAgent: a,
        agents: [a],
        setSelection,
      }),
    );
    expect(setSelection).not.toHaveBeenCalled();
  });

  it("hands selection to a same-cwd sibling when the resolved agent disappears", () => {
    // Render once with the agent resolved so the hook captures its
    // (target, cwd) into refs. Then re-render with the agent gone — that's
    // the death signal we want to react to.
    const setSelection = vi.fn();
    const a = agent({ target: "a", cwd: "/foo" });
    const b = agent({ target: "b", cwd: "/foo" });
    const c = agent({ target: "c", cwd: "/bar" });
    const selection: Selection = { type: "agent", id: "a" };
    const { rerender } = renderHook(
      ({ selectedAgent, agents }: FallbackProps) =>
        useAgentSelectionFallback({ selection, selectedAgent, agents, setSelection }),
      { initialProps: { selectedAgent: a, agents: [a, b, c] } as FallbackProps },
    );

    rerender({ selectedAgent: undefined, agents: [b, c] });

    expect(setSelection).toHaveBeenCalledTimes(1);
    expect(setSelection).toHaveBeenCalledWith({ type: "agent", id: "b" });
  });

  it("prefers orchestrator within the same cwd group", () => {
    // Mirrors the sidebar's "orchestrator on top" sort — the killed
    // agent's neighbour is the orchestrator if one is present, even when
    // a non-orchestrator was inserted earlier.
    const setSelection = vi.fn();
    const a = agent({ target: "a", cwd: "/foo" });
    const worker = agent({ target: "worker", cwd: "/foo" });
    const orch = agent({ target: "orch", cwd: "/foo", is_orchestrator: true });
    const { rerender } = renderHook(
      ({ selectedAgent, agents }: FallbackProps) =>
        useAgentSelectionFallback({
          selection: { type: "agent", id: "a" },
          selectedAgent,
          agents,
          setSelection,
        }),
      { initialProps: { selectedAgent: a, agents: [a, worker, orch] } as FallbackProps },
    );

    rerender({ selectedAgent: undefined, agents: [worker, orch] });

    expect(setSelection).toHaveBeenCalledWith({ type: "agent", id: "orch" });
  });

  it("falls back to any agent when no same-cwd sibling exists", () => {
    const setSelection = vi.fn();
    const a = agent({ target: "a", cwd: "/foo" });
    const c = agent({ target: "c", cwd: "/bar" });
    const { rerender } = renderHook(
      ({ selectedAgent, agents }: FallbackProps) =>
        useAgentSelectionFallback({
          selection: { type: "agent", id: "a" },
          selectedAgent,
          agents,
          setSelection,
        }),
      { initialProps: { selectedAgent: a, agents: [a, c] } as FallbackProps },
    );

    rerender({ selectedAgent: undefined, agents: [c] });

    expect(setSelection).toHaveBeenCalledWith({ type: "agent", id: "c" });
  });

  it("clears selection when the entity list becomes empty", () => {
    const setSelection = vi.fn();
    const a = agent({ target: "a", cwd: "/foo" });
    const { rerender } = renderHook(
      ({ selectedAgent, agents }: FallbackProps) =>
        useAgentSelectionFallback({
          selection: { type: "agent", id: "a" },
          selectedAgent,
          agents,
          setSelection,
        }),
      { initialProps: { selectedAgent: a, agents: [a] } as FallbackProps },
    );

    rerender({ selectedAgent: undefined, agents: [] });

    expect(setSelection).toHaveBeenCalledWith(null);
  });

  it("does not yank focus during a spawn-time pre-resolution gap", () => {
    // The user has an agent selected. A spawn flips selection.id to the
    // new session id; the wire round-trip hasn't landed yet, so
    // selectedAgent goes briefly undefined while the OLD agent is still
    // in `agents`. Reacting to that gap as a death would re-select the
    // old agent and stomp on the spawn intent — the hook must hold off.
    const setSelection = vi.fn();
    const oldAgent = agent({ target: "old", cwd: "/foo" });
    const { rerender } = renderHook(
      ({ selection, selectedAgent, agents }: FullFallbackProps) =>
        useAgentSelectionFallback({ selection, selectedAgent, agents, setSelection }),
      {
        initialProps: {
          selection: { type: "agent", id: "old" },
          selectedAgent: oldAgent,
          agents: [oldAgent],
        } as FullFallbackProps,
      },
    );

    rerender({
      selection: { type: "agent", id: "new-session" },
      selectedAgent: undefined,
      agents: [oldAgent],
    });

    expect(setSelection).not.toHaveBeenCalled();
  });

  it("does not interfere when the user navigated to a non-agent selection", () => {
    // User had an agent selected, then clicked a worktree. selectedAgent
    // becomes undefined because the selection type changed, not because
    // the agent died. Hook should leave selection alone.
    const setSelection = vi.fn();
    const a = agent({ target: "a", cwd: "/foo" });
    type WorktreeNavProps = {
      selection: Selection | null;
      selectedAgent: AgentSnapshot | undefined;
    };
    const { rerender } = renderHook(
      ({ selection, selectedAgent }: WorktreeNavProps) =>
        useAgentSelectionFallback({
          selection,
          selectedAgent,
          agents: [a],
          setSelection,
        }),
      {
        initialProps: {
          selection: { type: "agent", id: "a" },
          selectedAgent: a,
        } as WorktreeNavProps,
      },
    );

    rerender({
      selection: {
        type: "worktree",
        repoPath: "/foo",
        name: "wt",
        worktreePath: "/foo/wt",
      } as Selection,
      selectedAgent: undefined,
    });

    expect(setSelection).not.toHaveBeenCalled();
  });
});
