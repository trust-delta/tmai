// @vitest-environment jsdom
//
// Unit tests for `findProducerForUnit` — the shared Producer resolver
// that every "talk to the Producer" surface (digest button, ctx
// readout, conversation-header gate, failure-dialog Force-kill target)
// reads from.
//
// Two contract axes the resolver MUST honour:
//
//  1. **Cross-repo awareness** (tmai-core #439 / #460, public mirror
//     tmai#741). When a unit spans multiple repos, the resolver pins
//     the Producer to the unit's PRIMARY repo specifically — a
//     `claude:`+`!is_worktree` agent that happens to sit at a NON-primary
//     repo of the same unit is NOT mis-classified as the unit's
//     Producer. The Producer launch always runs at the primary repo, so
//     anything elsewhere is at most a sibling Claude session, not the
//     Producer.
//
//  2. **Back-compat single-path overload**. Callers not yet threaded
//     through the units wire (and cwd-synthesized units that the units
//     endpoint doesn't enumerate) pass a single `string` repo path,
//     which the resolver treats as the primary directly.

import { describe, expect, it } from "vitest";
import type { AgentSnapshot, UnitRepoWire } from "@/lib/api";
import { findProducerForUnit } from "../producer";

function stubAgent(partial: Partial<AgentSnapshot> & { id: string }): AgentSnapshot {
  return {
    id: partial.id,
    target: partial.target ?? partial.id,
    agent_type: partial.agent_type ?? "ClaudeCode",
    title: partial.title ?? partial.id,
    cwd: partial.cwd ?? "/repo",
    display_cwd: partial.display_cwd ?? "repo",
    display_name: partial.display_name ?? partial.id,
    detection_source: partial.detection_source ?? "IpcSocket",
    git_branch: partial.git_branch ?? "main",
    git_dirty: partial.git_dirty ?? false,
    is_worktree: partial.is_worktree ?? false,
    // Honour an explicit `null` (a wrapper-dir Producer's cwd has no
    // `git_common_dir`); only a wholly-omitted key gets the repo default.
    git_common_dir: partial.git_common_dir === undefined ? "/repo/.git" : partial.git_common_dir,
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

describe("findProducerForUnit — back-compat single-path overload", () => {
  it("returns null when the unit path is null", () => {
    expect(findProducerForUnit([], null)).toBeNull();
  });

  it("resolves a single `claude:`+`!is_worktree` agent at the unit path", () => {
    const producer = stubAgent({
      id: "claude:prod-1",
      cwd: "/repo",
      git_common_dir: "/repo/.git",
      is_worktree: false,
    });
    expect(findProducerForUnit([producer], "/repo")).toBe(producer);
  });

  it("normalizes a trailing `/.git` on the unit path before matching", () => {
    const producer = stubAgent({
      id: "claude:prod-1",
      cwd: "/repo",
      git_common_dir: "/repo/.git",
      is_worktree: false,
    });
    expect(findProducerForUnit([producer], "/repo/.git")).toBe(producer);
  });

  it("rejects an agent without the canonical `claude:` id scheme", () => {
    const notProducer = stubAgent({
      id: "codex:c-1",
      cwd: "/repo",
      git_common_dir: "/repo/.git",
      is_worktree: false,
    });
    expect(findProducerForUnit([notProducer], "/repo")).toBeNull();
  });

  it("rejects an agent with `is_worktree: true` (worktree clones host workers, not Producers)", () => {
    const worker = stubAgent({
      id: "claude:work-1",
      cwd: "/repo/.claude/worktrees/feat-x",
      git_common_dir: "/repo/.git",
      is_worktree: true,
    });
    expect(findProducerForUnit([worker], "/repo")).toBeNull();
  });

  it("returns null when more than one candidate is present (single-Producer invariant)", () => {
    const a = stubAgent({
      id: "claude:prod-a",
      cwd: "/repo",
      git_common_dir: "/repo/.git",
      is_worktree: false,
    });
    const b = stubAgent({
      id: "claude:prod-b",
      cwd: "/repo",
      git_common_dir: "/repo/.git",
      is_worktree: false,
    });
    expect(findProducerForUnit([a, b], "/repo")).toBeNull();
  });
});

describe("findProducerForUnit — cross-repo (UnitRepoWire[]) overload", () => {
  // The unit's repo membership as the units wire serves it: primary
  // first, secondary after. The resolver pins the Producer to the
  // primary-flagged row internally.
  const multiRepoUnit: Array<UnitRepoWire> = [
    { path: "/repos/primary", primary: true },
    { path: "/repos/secondary", primary: false },
  ];

  it("resolves an agent at the unit's PRIMARY repo as the Producer", () => {
    const producer = stubAgent({
      id: "claude:prod-1",
      cwd: "/repos/primary",
      git_common_dir: "/repos/primary/.git",
      is_worktree: false,
    });
    expect(findProducerForUnit([producer], multiRepoUnit)).toBe(producer);
  });

  it("does NOT mis-classify a `claude:`+`!is_worktree` agent at a NON-primary repo", () => {
    // The agent matches all the same shape filters as a Producer
    // (`claude:` + `!is_worktree`) but sits at the unit's secondary
    // repo — the Producer launch only ever runs at the primary, so
    // this agent must NOT be returned as the unit's Producer even
    // though it would have looked like one under the old single-path
    // filter.
    const nonPrimaryClaude = stubAgent({
      id: "claude:sibling-1",
      cwd: "/repos/secondary",
      git_common_dir: "/repos/secondary/.git",
      is_worktree: false,
    });
    expect(findProducerForUnit([nonPrimaryClaude], multiRepoUnit)).toBeNull();
  });

  it("returns the primary-repo Producer even when a non-primary sibling Claude session also exists", () => {
    const producer = stubAgent({
      id: "claude:prod-1",
      cwd: "/repos/primary",
      git_common_dir: "/repos/primary/.git",
      is_worktree: false,
    });
    const sibling = stubAgent({
      id: "claude:sibling-1",
      cwd: "/repos/secondary",
      git_common_dir: "/repos/secondary/.git",
      is_worktree: false,
    });
    expect(findProducerForUnit([producer, sibling], multiRepoUnit)).toBe(producer);
  });

  it("returns null when the unit has no primary-flagged row (refuses to guess)", () => {
    // Malformed wire payload — the resolver MUST refuse rather than
    // pick a Producer location heuristically. The simulated-onboarded
    // posture DR forbids fabricating data when the wire is incoherent.
    const allSecondary: Array<UnitRepoWire> = [
      { path: "/repos/a", primary: false },
      { path: "/repos/b", primary: false },
    ];
    const claudeAtA = stubAgent({
      id: "claude:prod-1",
      cwd: "/repos/a",
      git_common_dir: "/repos/a/.git",
      is_worktree: false,
    });
    expect(findProducerForUnit([claudeAtA], allSecondary)).toBeNull();
  });

  it("treats an empty repo list the same as a missing primary (null)", () => {
    const claudeAtPrimary = stubAgent({
      id: "claude:prod-1",
      cwd: "/repos/primary",
      git_common_dir: "/repos/primary/.git",
      is_worktree: false,
    });
    expect(findProducerForUnit([claudeAtPrimary], [])).toBeNull();
  });

  it("preserves the single-Producer invariant when two `claude:` agents are both at the primary repo", () => {
    // The cross-repo signature widens repo eligibility but does NOT
    // weaken the "exactly one or null" invariant. Two same-shape
    // agents at the primary repo → ambiguous → null.
    const a = stubAgent({
      id: "claude:prod-a",
      cwd: "/repos/primary",
      git_common_dir: "/repos/primary/.git",
      is_worktree: false,
    });
    const b = stubAgent({
      id: "claude:prod-b",
      cwd: "/repos/primary",
      git_common_dir: "/repos/primary/.git",
      is_worktree: false,
    });
    expect(findProducerForUnit([a, b], multiRepoUnit)).toBeNull();
  });
});

describe("findProducerForUnit — wrapper-dir project model (tmai-core #529/#530)", () => {
  // The wrapper-dir model launches the unit's Producer at the WRAPPER
  // directory — the parent that holds the unit's auto-discovered member
  // repos — not at a repo root. The wrapper is not itself a git repo, so
  // the Producer's `git_common_dir` is null and the resolver falls back to
  // its cwd, which sits one level ABOVE the primary repo path.
  const multiRepoUnit: Array<UnitRepoWire> = [
    { path: "/works/u/primary", primary: true },
    { path: "/works/u/secondary", primary: false },
  ];

  it("resolves a Producer launched at the unit wrapper dir (cross-repo overload)", () => {
    const producer = stubAgent({
      id: "claude:prod-1",
      cwd: "/works/u",
      git_common_dir: null, // wrapper is not a git repo
      is_worktree: false,
    });
    expect(findProducerForUnit([producer], multiRepoUnit)).toBe(producer);
  });

  it("resolves a wrapper-dir Producer via the back-compat single-path overload", () => {
    const producer = stubAgent({
      id: "claude:prod-1",
      cwd: "/works/u",
      git_common_dir: null,
      is_worktree: false,
    });
    // The single-path overload receives the unit's primary repo path; the
    // wrapper one level up still resolves.
    expect(findProducerForUnit([producer], "/works/u/primary")).toBe(producer);
  });

  it("does NOT mis-classify a Claude session sitting AT a member repo as the wrapper Producer", () => {
    // A session at the secondary repo is at neither the primary repo nor the
    // wrapper — the wrapper-position widening must not pull it in.
    const atSecondary = stubAgent({
      id: "claude:sibling-1",
      cwd: "/works/u/secondary",
      git_common_dir: "/works/u/secondary/.git",
      is_worktree: false,
    });
    expect(findProducerForUnit([atSecondary], multiRepoUnit)).toBeNull();
  });

  it("preserves the single-Producer invariant — a wrapper agent and a primary-repo agent are ambiguous", () => {
    const atWrapper = stubAgent({
      id: "claude:prod-a",
      cwd: "/works/u",
      git_common_dir: null,
      is_worktree: false,
    });
    const atPrimary = stubAgent({
      id: "claude:prod-b",
      cwd: "/works/u/primary",
      git_common_dir: "/works/u/primary/.git",
      is_worktree: false,
    });
    expect(findProducerForUnit([atWrapper, atPrimary], multiRepoUnit)).toBeNull();
  });
});
