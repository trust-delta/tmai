import { describe, expect, it } from "vitest";
import type { AgentSnapshot, WorktreeGroup } from "@/lib/api-http";

// ---- Helper: sort agents with the Producer pinned to top (mirrors WorktreeSection) ----
// Keys on the `is_producer` wire field (DR `2026-05-16-producer-identity-
// and-operator-addressing` §B); the pre-#836 `is_orchestrator` read was
// silently absent and pinned nothing.
function sortAgentsProducerFirst(agents: AgentSnapshot[]): AgentSnapshot[] {
  return [...agents].sort((a, b) => {
    if (a.is_producer && !b.is_producer) return -1;
    if (!a.is_producer && b.is_producer) return 1;
    return 0;
  });
}

// ---- Helper: check if a Producer is already running in project (mirrors ProjectGroup) ----
function hasRunningProducer(worktrees: WorktreeGroup[]): boolean {
  return worktrees.some((wt) => wt.agents.some((a) => a.is_producer));
}

// Minimal AgentSnapshot stub for testing
function stubAgent(overrides: Partial<AgentSnapshot> = {}): AgentSnapshot {
  return {
    id: "test-id",
    pane_id: "main:0.0",
    target: "main:0.0",
    agent_type: "ClaudeCode",
    status: "Idle",
    title: "",
    cwd: "/tmp",
    display_cwd: "/tmp",
    pid: 1234,
    session: "main",
    window_name: "window0",
    window_index: 0,
    pane_index: 0,
    last_update: new Date().toISOString(),
    detection_source: "CapturePane",
    is_virtual: false,
    mode: "Default",
    display_name: "main:0.0",
    active_subagents: 0,
    compaction_count: 0,
    send_capability: "Tmux",
    git_branch: null,
    git_dirty: null,
    is_worktree: null,
    git_common_dir: null,
    worktree_name: null,
    worktree_base_branch: null,
    effort_level: null,
    team_info: null,
    pty_session_id: null,
    is_producer: false,
    ...overrides,
  } as AgentSnapshot;
}

describe("Producer agent sorting", () => {
  it("pins the Producer agent to the top of the list", () => {
    const agents = [
      stubAgent({ id: "worker-1", is_producer: false }),
      stubAgent({ id: "producer", is_producer: true }),
      stubAgent({ id: "worker-2", is_producer: false }),
    ];
    const sorted = sortAgentsProducerFirst(agents);
    expect(sorted[0].id).toBe("producer");
    expect(sorted[1].id).toBe("worker-1");
    expect(sorted[2].id).toBe("worker-2");
  });

  it("preserves order when no Producer present", () => {
    const agents = [stubAgent({ id: "a" }), stubAgent({ id: "b" }), stubAgent({ id: "c" })];
    const sorted = sortAgentsProducerFirst(agents);
    expect(sorted.map((a) => a.id)).toEqual(["a", "b", "c"]);
  });

  it("handles empty agent list", () => {
    expect(sortAgentsProducerFirst([])).toEqual([]);
  });
});

describe("hasRunningProducer", () => {
  it("returns true when the Producer exists in a worktree", () => {
    const worktrees: WorktreeGroup[] = [
      {
        name: "main",
        path: "/project",
        branch: "main",
        isWorktree: false,
        dirty: false,
        agents: [stubAgent({ is_producer: true })],
      },
    ];
    expect(hasRunningProducer(worktrees)).toBe(true);
  });

  it("returns false when only same-unit workers exist", () => {
    const worktrees: WorktreeGroup[] = [
      {
        name: "main",
        path: "/project",
        branch: "main",
        isWorktree: false,
        dirty: false,
        agents: [stubAgent({ is_producer: false }), stubAgent({ is_producer: false })],
      },
    ];
    expect(hasRunningProducer(worktrees)).toBe(false);
  });

  it("returns false for empty worktrees", () => {
    expect(hasRunningProducer([])).toBe(false);
  });

  it("detects the Producer across multiple worktrees", () => {
    const worktrees: WorktreeGroup[] = [
      {
        name: "main",
        path: "/project",
        branch: "main",
        isWorktree: false,
        dirty: false,
        agents: [stubAgent({ is_producer: false })],
      },
      {
        name: "feature",
        path: "/project/.claude/worktrees/feature",
        branch: "feature",
        isWorktree: true,
        dirty: false,
        agents: [stubAgent({ is_producer: true })],
      },
    ];
    expect(hasRunningProducer(worktrees)).toBe(true);
  });
});
