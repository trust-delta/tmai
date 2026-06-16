// @vitest-environment jsdom
//
// Aggregation tests for the Producer console's hand-over digest.
//
// We mock `useAgents`, `useWorktrees`, and `useUnits` directly so the
// test exercises `useHandover`'s composition logic (project grouping,
// attention filtering, state-pill derivation, cross-unit reconciliation)
// without spinning up SSEProvider or hitting `api.units`.

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSnapshot, UnitsResponse, WorktreeSnapshot } from "@/lib/api";
import { useHandover } from "../useHandover";

const useAgentsMock = vi.fn();
const useWorktreesMock = vi.fn();
const useUnitsMock = vi.fn();

vi.mock("@/hooks/useAgents", () => ({
  useAgents: () => useAgentsMock(),
}));

vi.mock("@/hooks/useWorktrees", () => ({
  useWorktrees: () => useWorktreesMock(),
}));

vi.mock("@/hooks/useUnits", () => ({
  useUnits: () => useUnitsMock(),
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
    is_producer: partial.is_producer,
  };
}

beforeEach(() => {
  useAgentsMock.mockReset();
  useWorktreesMock.mockReset();
  useUnitsMock.mockReset();
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
  // Default: no configured-unit membership loaded (wire pre-resolve).
  // Tests that exercise reconciliation override this per-case.
  useUnitsMock.mockReturnValue({
    data: null,
    loading: true,
    error: null,
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

  it("returns only client-derived sections — the two compose-driven sections own their own polling", () => {
    const { result } = renderHook(() => useHandover(null));
    // Both `⬡ Settled decisions` and `◐ Working with this human` now
    // poll their respective endpoints directly (via `useDecisions` /
    // `useWorkingWithHuman`); the hook keeps only the client-derived
    // signals.
    expect(result.current.whereYouLeftOff).toBeDefined();
    expect(result.current.crossUnit).toBeDefined();
    expect(result.current.missingPreconditions).toBeDefined();
    // Property-absence guard: a stray placeholder on the digest type
    // would re-introduce the contract drift removed here.
    expect("workingWithHuman" in result.current).toBe(false);
    expect("settledDecisions" in result.current).toBe(false);
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

  it("flags the Producer attention agent via is_producer, not the same-unit worker", () => {
    // Both agents are blocked (non-null attention) and share the scoped
    // project, so both surface in `attentionAgents`. The brief's
    // `isProducer` must come off the `is_producer` wire field: the
    // Producer (`is_producer: true`) flags true, a same-unit worker
    // (`is_producer: false`) flags false. Pre-#836 this read the stale
    // `is_orchestrator` and every brief flagged false.
    useAgentsMock.mockReturnValue({
      agents: [
        agent({
          id: "claude:producer",
          cwd: "/home/u/proj-a",
          git_common_dir: "/home/u/proj-a/.git",
          attention: "halted",
          display_name: "producer-agent",
          is_producer: true,
        }),
        agent({
          id: "claude:worker",
          cwd: "/home/u/proj-a",
          git_common_dir: "/home/u/proj-a/.git",
          attention: "halted",
          display_name: "worker-agent",
          is_producer: false,
        }),
      ],
      attentionCount: 2,
      loading: false,
      refresh: vi.fn(),
    });

    const { result } = renderHook(() => useHandover("/home/u/proj-a"));
    const briefs = result.current.whereYouLeftOff.attentionAgents;
    const producer = briefs.find((a) => a.displayName === "producer-agent");
    const worker = briefs.find((a) => a.displayName === "worker-agent");
    expect(producer?.isProducer).toBe(true);
    expect(worker?.isProducer).toBe(false);
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

describe("useHandover — crossUnit reconciliation against api.units()", () => {
  // tmai-core #460 closes the dormant-unit gap: configured `[[unit]]`
  // tables that have no live agent must still appear in the cross-unit
  // status section so the operator can SELECT them (and spawn a
  // Producer at their primary repo). The state pill stays
  // client-derived; reconciliation only adds rows, never alters them.

  it("appends a configured unit with no live agents as state: quiet", () => {
    useAgentsMock.mockReturnValue({
      agents: [agent({ id: "a1", cwd: "/home/u/proj-a", git_common_dir: "/home/u/proj-a/.git" })],
      attentionCount: 0,
      loading: false,
      refresh: vi.fn(),
    });
    const unitsData: UnitsResponse = {
      units: [
        // Live unit — already covered by `proj-a` live row.
        { name: "proj-a", repos: [{ path: "/home/u/proj-a", primary: true }] },
        // Dormant unit — must be reconciled in.
        { name: "proj-dormant", repos: [{ path: "/home/u/proj-dormant", primary: true }] },
      ],
    };
    useUnitsMock.mockReturnValue({ data: unitsData, loading: false, error: null });

    const { result } = renderHook(() => useHandover(null));
    const names = result.current.crossUnit.units.map((u) => u.name);
    expect(names).toEqual(expect.arrayContaining(["proj-a", "proj-dormant"]));
    const dormant = result.current.crossUnit.units.find((u) => u.name === "proj-dormant");
    expect(dormant?.state).toBe("quiet");
    expect(dormant?.agentCount).toBe(0);
    expect(dormant?.attentionCount).toBe(0);
    // Dormant row points at the unit's primary repo path so unit
    // selection sets `currentProject` to the spawn-cwd target.
    expect(dormant?.path).toBe("/home/u/proj-dormant");
  });

  it("does not duplicate a configured unit that already has live agents", () => {
    useAgentsMock.mockReturnValue({
      agents: [agent({ id: "a1", cwd: "/home/u/proj-a", git_common_dir: "/home/u/proj-a/.git" })],
      attentionCount: 0,
      loading: false,
      refresh: vi.fn(),
    });
    const unitsData: UnitsResponse = {
      units: [{ name: "proj-a", repos: [{ path: "/home/u/proj-a", primary: true }] }],
    };
    useUnitsMock.mockReturnValue({ data: unitsData, loading: false, error: null });

    const { result } = renderHook(() => useHandover(null));
    expect(result.current.crossUnit.units).toHaveLength(1);
    expect(result.current.crossUnit.units[0]?.name).toBe("proj-a");
    // Live row's state survives reconciliation (in-progress, not quiet).
    expect(result.current.crossUnit.units[0]?.state).toBe("in-progress");
  });

  it("falls back to live-only rows while api.units() is still resolving", () => {
    useAgentsMock.mockReturnValue({
      agents: [agent({ id: "a1", cwd: "/home/u/proj-a", git_common_dir: "/home/u/proj-a/.git" })],
      attentionCount: 0,
      loading: false,
      refresh: vi.fn(),
    });
    useUnitsMock.mockReturnValue({ data: null, loading: true, error: null });

    const { result } = renderHook(() => useHandover(null));
    expect(result.current.crossUnit.units).toHaveLength(1);
    expect(result.current.crossUnit.units[0]?.name).toBe("proj-a");
  });
});

describe("useHandover — missingPreconditions (simulated-onboarded posture)", () => {
  it("flags noLiveAgents when the agent list is empty", () => {
    const { result } = renderHook(() => useHandover(null));
    expect(result.current.missingPreconditions.noLiveAgents).toBe(true);
  });

  it("clears noLiveAgents once any AI agent is observed", () => {
    useAgentsMock.mockReturnValue({
      agents: [agent({ id: "a1", cwd: "/home/u/proj-a", git_common_dir: "/home/u/proj-a/.git" })],
      attentionCount: 0,
      loading: false,
      refresh: vi.fn(),
    });

    const { result } = renderHook(() => useHandover(null));
    expect(result.current.missingPreconditions.noLiveAgents).toBe(false);
  });

  // The Producer launch wraps `tmai producer <unit>` under `bash -c` to
  // satisfy tmai-core's `/api/spawn` allow-list (DR polish v4). The
  // resulting agent has `agent_type: Custom("bash")` but its canonical
  // `id` is already `claude:UUID` — `useHandover` must classify it as
  // an AI coding agent via the id-scheme fallback, otherwise the
  // Producer's own unit drops out of `projectGroups` and the posture
  // notices ("no live agents") misfire even though the Producer is
  // plainly running.
  it("classifies a bash-wrapped Producer as an AI agent via canonical id scheme", () => {
    useAgentsMock.mockReturnValue({
      agents: [
        agent({
          id: "claude:8b762cf8-b5e1-48f1-a828-af6411d58e96",
          agent_type: { Custom: "bash" },
          title: "bash",
          cwd: "/home/u/proj-a",
          git_common_dir: "/home/u/proj-a/.git",
        }),
      ],
      attentionCount: 0,
      loading: false,
      refresh: vi.fn(),
    });

    const { result } = renderHook(() => useHandover(null));
    expect(result.current.missingPreconditions.noLiveAgents).toBe(false);
    expect(result.current.crossUnit.units).toHaveLength(1);
  });

  it("does not classify a plain Custom-type agent without an AI id scheme", () => {
    useAgentsMock.mockReturnValue({
      agents: [
        agent({
          id: "pty:00000000-0000-0000-0000-000000000001",
          agent_type: { Custom: "bash" },
          title: "bash",
          cwd: "/home/u/proj-a",
          git_common_dir: "/home/u/proj-a/.git",
        }),
      ],
      attentionCount: 0,
      loading: false,
      refresh: vi.fn(),
    });

    const { result } = renderHook(() => useHandover(null));
    expect(result.current.missingPreconditions.noLiveAgents).toBe(true);
    expect(result.current.crossUnit.units).toEqual([]);
  });

  // Field-absence guard: `singleUnitOnly` retired with the units-wire
  // reconciliation (tmai-core #460). Any reader that quietly resurrects
  // it would surface as a TS error first — this assertion documents the
  // contract at runtime so a `Partial<MissingPreconditions>` casting
  // accident can't sneak the field back in.
  it("does not carry the retired singleUnitOnly field on missingPreconditions", () => {
    const { result } = renderHook(() => useHandover(null));
    expect("singleUnitOnly" in result.current.missingPreconditions).toBe(false);
  });
});
