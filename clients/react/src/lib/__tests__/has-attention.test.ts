// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { type AgentAttention, type AgentSnapshot, hasAttention } from "../api-http";

// Minimal AgentSnapshot stub — `hasAttention` reads only `attention`, so the
// rest are inert. `attention` defaults to `null` ("running normally").
function stubAgent(overrides: Partial<AgentSnapshot> = {}): AgentSnapshot {
  return {
    id: "claude:agent",
    target: "claude:agent",
    agent_type: "ClaudeCode",
    title: "",
    cwd: "/home/u/works/tmai",
    display_cwd: "/home/u/works/tmai",
    display_name: "claude:agent",
    detection_source: "HttpHook",
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
    send_capability: "PtyInject",
    is_virtual: false,
    team_info: null,
    attention: null,
    ...overrides,
  };
}

describe("hasAttention — shared user-blocked-axis predicate (#583 §軸A)", () => {
  it("is false when attention is null (running normally)", () => {
    expect(hasAttention(stubAgent({ attention: null }))).toBe(false);
  });

  it("is false when attention is absent on the wire (forward-compat / unknown)", () => {
    // The sampler-bootstrap window omits `attention` entirely; `!= null`
    // collapses both `null` and `undefined` to "no signal".
    expect(hasAttention(stubAgent({ attention: undefined }))).toBe(false);
  });

  it.each<AgentAttention>([
    "started",
    "halted",
    "completed",
  ])("is true for the user-blocked state %s", (attention) => {
    expect(hasAttention(stubAgent({ attention }))).toBe(true);
  });

  it("counts the blocked agents in a mixed list (the StatusBar / group-badge use)", () => {
    const agents = [
      stubAgent({ attention: null }),
      stubAgent({ attention: "halted" }),
      stubAgent({ attention: undefined }),
      stubAgent({ attention: "completed" }),
    ];
    expect(agents.filter(hasAttention).length).toBe(2);
  });

  it("narrows `attention` to a non-null AgentAttention (type guard)", () => {
    const agents = [stubAgent({ attention: "started" }), stubAgent({ attention: null })];
    // After `filter(hasAttention)`, `a.attention` is `AgentAttention` — read
    // it WITHOUT a non-null assertion. This compiling (tsc gate) is the
    // narrowing contract the digest's `attentionAgents` map relies on.
    const reasons: AgentAttention[] = agents.filter(hasAttention).map((a) => a.attention);
    expect(reasons).toEqual(["started"]);
  });
});
