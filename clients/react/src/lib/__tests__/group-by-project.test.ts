// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { type AgentSnapshot, groupByProject } from "../api-http";

// Minimal AgentSnapshot stub — only the fields `groupByProject` reads
// (unit, git_common_dir, cwd, is_worktree, worktree_name, git_branch,
// git_dirty, attention) need to be meaningful; the rest are inert.
function stubAgent(overrides: Partial<AgentSnapshot> = {}): AgentSnapshot {
  return {
    id: "claude:agent",
    target: "claude:agent",
    agent_type: "ClaudeCode",
    title: "",
    cwd: "/home/u/works/tmai",
    display_cwd: "/home/u/works/tmai",
    display_name: "claude:agent",
    detection_source: "http_hook",
    git_branch: null,
    git_dirty: false,
    is_worktree: false,
    git_common_dir: "/home/u/works/tmai/.git",
    worktree_name: null,
    worktree_base_branch: null,
    effort_level: null,
    active_subagents: 0,
    compaction_count: 0,
    pty_session_id: null,
    is_virtual: false,
    team_info: null,
    attention: null,
    ...overrides,
  };
}

describe("groupByProject — unit grouping (#439)", () => {
  it("collapses agents sharing a unit but with different git_common_dir into ONE group", () => {
    // The multi-repo unit `tmai` = repos `tmai` + `tmai-core`. Two agents,
    // two repos, one unit — the whole point of #439.
    const tmaiAgent = stubAgent({
      id: "claude:prod",
      target: "claude:prod",
      unit: "tmai",
      git_common_dir: "/home/u/works/tmai/.git",
      cwd: "/home/u/works/tmai",
    });
    const coreAgent = stubAgent({
      id: "claude:core",
      target: "claude:core",
      unit: "tmai",
      git_common_dir: "/home/u/works/tmai-core/.git",
      cwd: "/home/u/works/tmai-core",
    });

    const groups = groupByProject([tmaiAgent, coreAgent]);

    expect(groups).toHaveLength(1);
    expect(groups[0].totalAgents).toBe(2);
    // Display the unit name…
    expect(groups[0].name).toBe("tmai");
    // …but `path` is a REAL repo dir (the primary repo, basename === unit),
    // never the bare unit name — App treats it as a filesystem path.
    expect(groups[0].path).toBe("/home/u/works/tmai");
  });

  it("preserves the within-unit worktree/main sub-structure", () => {
    const main = stubAgent({
      id: "claude:prod",
      target: "claude:prod",
      unit: "tmai",
      git_common_dir: "/home/u/works/tmai/.git",
      cwd: "/home/u/works/tmai",
      is_worktree: false,
      git_branch: "main",
    });
    const worktree = stubAgent({
      id: "claude:worker",
      target: "claude:worker",
      unit: "tmai",
      git_common_dir: "/home/u/works/tmai/.git",
      cwd: "/home/u/works/tmai/.claude/worktrees/feat-x",
      is_worktree: true,
      worktree_name: "feat-x",
      git_branch: "feat-x",
    });

    const groups = groupByProject([main, worktree]);

    expect(groups).toHaveLength(1);
    const [group] = groups;
    // main first, then worktrees sorted by name.
    expect(group.worktrees.map((wt) => wt.name)).toEqual(["main", "feat-x"]);

    const mainWt = group.worktrees.find((wt) => !wt.isWorktree);
    expect(mainWt?.agents.map((a) => a.id)).toEqual(["claude:prod"]);

    const featWt = group.worktrees.find((wt) => wt.name === "feat-x");
    expect(featWt?.isWorktree).toBe(true);
    expect(featWt?.agents.map((a) => a.id)).toEqual(["claude:worker"]);
  });

  it("collapses a multi-repo unit AND keeps its worktree sub-structure", () => {
    // tmai main + a tmai worktree + a tmai-core worker, all unit `tmai`.
    const tmaiMain = stubAgent({
      id: "claude:prod",
      target: "claude:prod",
      unit: "tmai",
      git_common_dir: "/home/u/works/tmai/.git",
      cwd: "/home/u/works/tmai",
      is_worktree: false,
      git_branch: "main",
    });
    const tmaiWorktree = stubAgent({
      id: "claude:worker",
      target: "claude:worker",
      unit: "tmai",
      git_common_dir: "/home/u/works/tmai/.git",
      cwd: "/home/u/works/tmai/.claude/worktrees/feat-x",
      is_worktree: true,
      worktree_name: "feat-x",
      git_branch: "feat-x",
    });
    const coreWorker = stubAgent({
      id: "claude:core",
      target: "claude:core",
      unit: "tmai",
      git_common_dir: "/home/u/works/tmai-core/.git",
      cwd: "/home/u/works/tmai-core",
      is_worktree: false,
    });

    const groups = groupByProject([tmaiMain, tmaiWorktree, coreWorker]);

    expect(groups).toHaveLength(1);
    expect(groups[0].totalAgents).toBe(3);
    expect(groups[0].path).toBe("/home/u/works/tmai");
    // The worktree sub-structure still distinguishes the feat-x worktree
    // from the (collapsed) repo roots.
    expect(groups[0].worktrees.map((wt) => wt.name)).toEqual(["main", "feat-x"]);
  });

  it("falls back to git_common_dir grouping when `unit` is absent", () => {
    // No `unit` → the pre-#439 behavior: one group per repo dir.
    const foo = stubAgent({
      id: "claude:foo",
      target: "claude:foo",
      git_common_dir: "/home/u/works/foo/.git",
      cwd: "/home/u/works/foo",
    });
    const bar = stubAgent({
      id: "claude:bar",
      target: "claude:bar",
      git_common_dir: "/home/u/works/bar/.git",
      cwd: "/home/u/works/bar",
    });

    const groups = groupByProject([foo, bar]);

    // Different repos, no unit → two separate groups (NOT collapsed).
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.path)).toEqual(["/home/u/works/bar", "/home/u/works/foo"]);
    expect(groups.map((g) => g.name)).toEqual(["bar", "foo"]);
  });

  it("treats an empty-string `unit` as absent (fallback)", () => {
    const agent = stubAgent({
      unit: "",
      git_common_dir: "/home/u/works/foo/.git",
      cwd: "/home/u/works/foo",
    });

    const groups = groupByProject([agent]);

    expect(groups).toHaveLength(1);
    expect(groups[0].path).toBe("/home/u/works/foo");
    expect(groups[0].name).toBe("foo");
  });

  it("keeps unit and unit-less agents in separate groups during the transition", () => {
    // Per-agent fallback: a unit-bearing agent and a unit-less one at a
    // different repo do not merge. Namespacing (`unit:` prefix) guarantees a
    // bare unit name can't collide with an absolute repo-dir key.
    const withUnit = stubAgent({
      id: "claude:u",
      target: "claude:u",
      unit: "tmai",
      git_common_dir: "/home/u/works/tmai/.git",
      cwd: "/home/u/works/tmai",
    });
    const withoutUnit = stubAgent({
      id: "claude:n",
      target: "claude:n",
      git_common_dir: "/home/u/works/other/.git",
      cwd: "/home/u/works/other",
    });

    const groups = groupByProject([withUnit, withoutUnit]);

    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.path).sort()).toEqual(["/home/u/works/other", "/home/u/works/tmai"]);
  });

  it("picks the first repo dir when no member's basename matches the unit name", () => {
    // A unit whose name matches none of its repos' basenames still resolves
    // to a real repo dir (the first member), never the bare unit name.
    const a = stubAgent({
      id: "claude:a",
      target: "claude:a",
      unit: "myproject",
      git_common_dir: "/home/u/works/frontend/.git",
      cwd: "/home/u/works/frontend",
    });
    const b = stubAgent({
      id: "claude:b",
      target: "claude:b",
      unit: "myproject",
      git_common_dir: "/home/u/works/backend/.git",
      cwd: "/home/u/works/backend",
    });

    const groups = groupByProject([a, b]);

    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe("myproject");
    expect(groups[0].path).toBe("/home/u/works/frontend");
  });
});
