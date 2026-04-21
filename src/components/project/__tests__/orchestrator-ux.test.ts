import { describe, expect, it } from "vitest";
import type { AgentSnapshot, WorktreeGroup } from "@/lib/api-http";

// ---- Helper: sort agents with orchestrator pinned to top (mirrors WorktreeSection) ----
function sortAgentsOrchestratorFirst(agents: AgentSnapshot[]): AgentSnapshot[] {
  return [...agents].sort((a, b) => {
    if (a.is_orchestrator && !b.is_orchestrator) return -1;
    if (!a.is_orchestrator && b.is_orchestrator) return 1;
    return 0;
  });
}

// ---- Helper: check if orchestrator is already running in project (mirrors ProjectGroup) ----
function hasRunningOrchestrator(worktrees: WorktreeGroup[]): boolean {
  return worktrees.some((wt) => wt.agents.some((a) => a.is_orchestrator));
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
    auto_approve_phase: null,
    auto_approve_override: null,
    git_branch: null,
    git_dirty: null,
    is_worktree: null,
    git_common_dir: null,
    worktree_name: null,
    worktree_base_branch: null,
    effort_level: null,
    team_info: null,
    pty_session_id: null,
    is_orchestrator: false,
    ...overrides,
  } as AgentSnapshot;
}

describe("orchestrator agent sorting", () => {
  it("pins orchestrator agent to the top of the list", () => {
    const agents = [
      stubAgent({ id: "worker-1" }),
      stubAgent({ id: "orch", is_orchestrator: true }),
      stubAgent({ id: "worker-2" }),
    ];
    const sorted = sortAgentsOrchestratorFirst(agents);
    expect(sorted[0].id).toBe("orch");
    expect(sorted[1].id).toBe("worker-1");
    expect(sorted[2].id).toBe("worker-2");
  });

  it("preserves order when no orchestrator present", () => {
    const agents = [stubAgent({ id: "a" }), stubAgent({ id: "b" }), stubAgent({ id: "c" })];
    const sorted = sortAgentsOrchestratorFirst(agents);
    expect(sorted.map((a) => a.id)).toEqual(["a", "b", "c"]);
  });

  it("handles empty agent list", () => {
    expect(sortAgentsOrchestratorFirst([])).toEqual([]);
  });
});

describe("hasRunningOrchestrator", () => {
  it("returns true when orchestrator exists in a worktree", () => {
    const worktrees: WorktreeGroup[] = [
      {
        name: "main",
        path: "/project",
        branch: "main",
        isWorktree: false,
        dirty: false,
        agents: [stubAgent({ is_orchestrator: true })],
      },
    ];
    expect(hasRunningOrchestrator(worktrees)).toBe(true);
  });

  it("returns false when no orchestrator exists", () => {
    const worktrees: WorktreeGroup[] = [
      {
        name: "main",
        path: "/project",
        branch: "main",
        isWorktree: false,
        dirty: false,
        agents: [stubAgent(), stubAgent()],
      },
    ];
    expect(hasRunningOrchestrator(worktrees)).toBe(false);
  });

  it("returns false for empty worktrees", () => {
    expect(hasRunningOrchestrator([])).toBe(false);
  });

  it("detects orchestrator across multiple worktrees", () => {
    const worktrees: WorktreeGroup[] = [
      {
        name: "main",
        path: "/project",
        branch: "main",
        isWorktree: false,
        dirty: false,
        agents: [stubAgent()],
      },
      {
        name: "feature",
        path: "/project/.claude/worktrees/feature",
        branch: "feature",
        isWorktree: true,
        dirty: false,
        agents: [stubAgent({ is_orchestrator: true })],
      },
    ];
    expect(hasRunningOrchestrator(worktrees)).toBe(true);
  });
});
