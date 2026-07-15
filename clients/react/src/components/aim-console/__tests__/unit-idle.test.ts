// @vitest-environment jsdom
//
// unit-idle — the cross-unit idle-passive source. A unit is idle when its
// Producer's terminal is quiescent (no output) AND no LIVE worker is still
// active (non-quiescent). Pins: an idle (quiescent) worker does not block idle,
// a DEAD worker's lingering record does not block idle, and a worker in ANOTHER
// unit is irrelevant.

import { describe, expect, it } from "vitest";
import type { AgentSnapshot } from "@/lib/api";
import { unitIsIdle } from "../unit-idle";

const REPO = "/works/tmai";

function stubAgent(partial: Partial<AgentSnapshot> & { id: string }): AgentSnapshot {
  return {
    id: partial.id,
    target: partial.target ?? partial.id,
    agent_type: partial.agent_type ?? "ClaudeCode",
    title: partial.title ?? partial.id,
    cwd: partial.cwd ?? REPO,
    display_cwd: partial.display_cwd ?? "tmai",
    display_name: partial.display_name ?? partial.id,
    detection_source: partial.detection_source ?? "pty_server",
    git_branch: partial.git_branch ?? "main",
    git_dirty: partial.git_dirty ?? false,
    is_worktree: partial.is_worktree ?? false,
    git_common_dir: partial.git_common_dir === undefined ? `${REPO}/.git` : partial.git_common_dir,
    unit: partial.unit,
    worktree_name: partial.worktree_name ?? null,
    worktree_base_branch: partial.worktree_base_branch ?? null,
    effort_level: partial.effort_level ?? null,
    active_subagents: partial.active_subagents ?? 0,
    compaction_count: partial.compaction_count ?? 0,
    pty_session_id: partial.pty_session_id ?? "sess",
    is_virtual: partial.is_virtual ?? false,
    team_info: partial.team_info ?? null,
    attention: partial.attention ?? null,
    is_producer: partial.is_producer,
    dead: partial.dead,
    quiescent: partial.quiescent,
  };
}

const producer = (quiescent?: boolean): AgentSnapshot =>
  stubAgent({ id: "claude:prod", is_producer: true, unit: "tmai", is_worktree: false, quiescent });

const worker = (over: Partial<AgentSnapshot>): AgentSnapshot =>
  stubAgent({
    id: over.id ?? "claude:w1",
    is_producer: false,
    unit: over.unit ?? "tmai",
    is_worktree: true,
    cwd: `${REPO}/.worktrees/w1`,
    git_common_dir: `${REPO}/.git`,
    ...over,
  });

describe("unitIsIdle", () => {
  it("Producer quiescent + no workers → idle", () => {
    expect(unitIsIdle([producer(true)], "tmai", REPO)).toBe(true);
  });

  it("Producer NOT quiescent (still moving) → not idle", () => {
    expect(unitIsIdle([producer(undefined)], "tmai", REPO)).toBe(false);
    expect(unitIsIdle([producer(false)], "tmai", REPO)).toBe(false);
  });

  it("no resolvable Producer → not idle", () => {
    expect(unitIsIdle([], "tmai", REPO)).toBe(false);
    // a lone worker, no Producer
    expect(unitIsIdle([worker({ quiescent: true })], "tmai", REPO)).toBe(false);
  });

  it("an ACTIVE (non-quiescent) worker blocks idle", () => {
    const agents = [producer(true), worker({ id: "claude:w1", quiescent: undefined })];
    expect(unitIsIdle(agents, "tmai", REPO)).toBe(false);
  });

  it("an idle (quiescent) worker does NOT block idle", () => {
    const agents = [producer(true), worker({ id: "claude:w1", quiescent: true })];
    expect(unitIsIdle(agents, "tmai", REPO)).toBe(true);
  });

  it("a DEAD non-quiescent worker does NOT block idle (its record just lingers)", () => {
    const agents = [producer(true), worker({ id: "claude:w1", quiescent: undefined, dead: true })];
    expect(unitIsIdle(agents, "tmai", REPO)).toBe(true);
  });

  it("an active worker in ANOTHER unit is irrelevant", () => {
    const agents = [
      producer(true),
      worker({ id: "claude:w-other", unit: "other-unit", quiescent: undefined }),
    ];
    expect(unitIsIdle(agents, "tmai", REPO)).toBe(true);
  });
});
