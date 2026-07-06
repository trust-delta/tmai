// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { type AgentSnapshot, resolveRepoDir } from "../api-http";

// Minimal AgentSnapshot stub — `resolveRepoDir` only reads `git_common_dir`
// and `cwd`; the rest are inert but required by the type.
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
    git_common_dir: null,
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

describe("resolveRepoDir — deepest-match prefix resolution (#839)", () => {
  it("prefers git_common_dir over any cwd prefix match", () => {
    const agent = stubAgent({
      git_common_dir: "/home/u/works/tmai/.git",
      cwd: "/home/u/works/tmai/tmai/src",
    });
    const cwdToGitDir = new Map([["/home/u/works/tmai/tmai", "/home/u/works/tmai/tmai"]]);

    // git_common_dir short-circuits the prefix scan entirely.
    expect(resolveRepoDir(agent, cwdToGitDir)).toBe("/home/u/works/tmai");
  });

  it("returns the exact cwd→git-dir hit when present", () => {
    const agent = stubAgent({ git_common_dir: null, cwd: "/home/u/works/tmai/tmai" });
    const cwdToGitDir = new Map([
      ["/home/u/works/tmai", "/home/u/works/tmai"],
      ["/home/u/works/tmai/tmai", "/home/u/works/tmai/tmai"],
    ]);

    expect(resolveRepoDir(agent, cwdToGitDir)).toBe("/home/u/works/tmai/tmai");
  });

  it("resolves an agent inside the DEEPER of two prefix-sharing repos to the deeper repo", () => {
    // Wrapper `.../tmai` and nested `.../tmai/tmai` are both repos; the agent
    // sits inside the nested one. Deepest (longest) matching prefix must win,
    // regardless of insertion order — here the SHALLOWER key is inserted first.
    const agent = stubAgent({ git_common_dir: null, cwd: "/home/u/works/tmai/tmai/src/lib" });
    const cwdToGitDir = new Map([
      ["/home/u/works/tmai", "/home/u/works/tmai"],
      ["/home/u/works/tmai/tmai", "/home/u/works/tmai/tmai"],
    ]);

    expect(resolveRepoDir(agent, cwdToGitDir)).toBe("/home/u/works/tmai/tmai");
  });

  it("is independent of Map iteration order (deeper wins even when inserted last)", () => {
    const agent = stubAgent({ git_common_dir: null, cwd: "/home/u/works/tmai/tmai/src/lib" });
    const cwdToGitDir = new Map([
      ["/home/u/works/tmai/tmai", "/home/u/works/tmai/tmai"],
      ["/home/u/works/tmai", "/home/u/works/tmai"],
    ]);

    expect(resolveRepoDir(agent, cwdToGitDir)).toBe("/home/u/works/tmai/tmai");
  });

  it("resolves the tmai/tmai case (wrapper name == nested same-named repo)", () => {
    // The nested repo shares the wrapper's basename (`tmai`). An agent inside
    // the nested `tmai/tmai` must bind to it, NOT the shallower wrapper `tmai`
    // and NOT the prefix-sharing sibling `tmai/tmai-core`.
    const agent = stubAgent({ git_common_dir: null, cwd: "/home/u/works/tmai/tmai/api-spec" });
    const cwdToGitDir = new Map([
      ["/home/u/works/tmai", "/home/u/works/tmai"],
      ["/home/u/works/tmai/tmai-core", "/home/u/works/tmai/tmai-core"],
      ["/home/u/works/tmai/tmai", "/home/u/works/tmai/tmai"],
    ]);

    expect(resolveRepoDir(agent, cwdToGitDir)).toBe("/home/u/works/tmai/tmai");
  });

  it("does NOT bind a sibling whose name shares a prefix (tmai vs tmai-core)", () => {
    // `agent.cwd.startsWith(cwd)` without a `/` boundary would have let the
    // `.../tmai` key match a `.../tmai-core` cwd. The `/`-boundary check stops
    // that: the agent inside `tmai-core` resolves to `tmai-core`, not `tmai`.
    const agent = stubAgent({ git_common_dir: null, cwd: "/home/u/works/tmai-core/src" });
    const cwdToGitDir = new Map([
      ["/home/u/works/tmai", "/home/u/works/tmai"],
      ["/home/u/works/tmai-core", "/home/u/works/tmai-core"],
    ]);

    expect(resolveRepoDir(agent, cwdToGitDir)).toBe("/home/u/works/tmai-core");
  });

  it("falls back to the deepest repo nested under a wrapper cwd", () => {
    // The agent sits AT the wrapper dir with no inside-repo match; the wrapper
    // fallback picks the deepest repo nested beneath it. With two siblings at
    // equal depth the lexicographically smaller key wins (order-independent).
    const agent = stubAgent({ git_common_dir: null, cwd: "/home/u/works/tmai" });
    const cwdToGitDir = new Map([
      ["/home/u/works/tmai/tmai-core", "/home/u/works/tmai/tmai-core"],
      ["/home/u/works/tmai/tmai", "/home/u/works/tmai/tmai"],
    ]);

    expect(resolveRepoDir(agent, cwdToGitDir)).toBe("/home/u/works/tmai/tmai");
  });

  it("prefers an inside-repo match over the wrapper fallback", () => {
    // Both an inside-repo match (`.../tmai` contains the agent) and a wrapper
    // candidate (`.../tmai/tmai` nested under… no — only inside applies here)
    // — the inside match must win. Agent is inside `.../tmai`, and a deeper
    // repo `.../tmai/tmai` is NOT under the agent's cwd's parent, so only the
    // inside branch fires.
    const agent = stubAgent({ git_common_dir: null, cwd: "/home/u/works/tmai/docs" });
    const cwdToGitDir = new Map([
      ["/home/u/works/tmai", "/home/u/works/tmai"],
      ["/home/u/works/tmai/tmai", "/home/u/works/tmai/tmai"],
    ]);

    // `/home/u/works/tmai/docs` is inside `/home/u/works/tmai` (inside match),
    // while `/home/u/works/tmai/tmai` is neither a parent nor a child of it.
    expect(resolveRepoDir(agent, cwdToGitDir)).toBe("/home/u/works/tmai");
  });

  it("leaves single-repo resolution unchanged", () => {
    const agent = stubAgent({ git_common_dir: null, cwd: "/home/u/works/solo/src" });
    const cwdToGitDir = new Map([["/home/u/works/solo", "/home/u/works/solo"]]);

    expect(resolveRepoDir(agent, cwdToGitDir)).toBe("/home/u/works/solo");
  });

  it("leaves distinct-name resolution unchanged", () => {
    const agent = stubAgent({ git_common_dir: null, cwd: "/home/u/works/backend/api" });
    const cwdToGitDir = new Map([
      ["/home/u/works/frontend", "/home/u/works/frontend"],
      ["/home/u/works/backend", "/home/u/works/backend"],
    ]);

    expect(resolveRepoDir(agent, cwdToGitDir)).toBe("/home/u/works/backend");
  });

  it("falls back to the agent's own cwd when nothing matches", () => {
    const agent = stubAgent({ git_common_dir: null, cwd: "/home/u/works/unknown" });
    const cwdToGitDir = new Map([["/home/u/works/other", "/home/u/works/other"]]);

    expect(resolveRepoDir(agent, cwdToGitDir)).toBe("/home/u/works/unknown");
  });
});
