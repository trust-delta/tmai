// @vitest-environment jsdom
//
// close-unit-slot — the webui half of the tmai-core #540 / #546 Producer-slot
// close: POST /api/units/{unit}/close (core kills the Producer + dispatched
// workers), then kill the unit's webui-owned, hint-less FOOTER BASH that the
// engine can't attribute on its own.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSnapshot, AgentType, SlotResponse } from "@/lib/api";

const closeUnitMock = vi.fn();
const killAgentMock = vi.fn();

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      closeUnit: (...args: unknown[]) => closeUnitMock(...args),
      killAgent: (...args: unknown[]) => killAgentMock(...args),
    },
  };
});

import { closeUnitSlot, findFooterShells } from "@/lib/close-unit-slot";

function unit(overrides: Partial<SlotResponse> = {}): SlotResponse {
  return {
    name: "tmai",
    repos: [
      { path: "/home/me/works/tmai", primary: true },
      { path: "/home/me/works/tmai-core", primary: false },
    ],
    ...overrides,
  };
}

function agent(overrides: { id: string; cwd: string; agentType?: AgentType }): AgentSnapshot {
  return {
    id: overrides.id,
    target: overrides.id,
    agent_type: overrides.agentType ?? { Custom: "bash" },
    title: overrides.id,
    cwd: overrides.cwd,
    display_cwd: overrides.cwd,
    display_name: overrides.id,
    detection_source: "http_hook",
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
    is_virtual: false,
    team_info: null,
    attention: null,
  } as AgentSnapshot;
}

beforeEach(() => {
  closeUnitMock.mockReset();
  killAgentMock.mockReset();
  closeUnitMock.mockResolvedValue(undefined);
  killAgentMock.mockResolvedValue(undefined);
});

describe("findFooterShells", () => {
  it("matches plain shells whose cwd is one of the unit's repos", () => {
    const shells = findFooterShells(unit(), [
      agent({ id: "pty-1", cwd: "/home/me/works/tmai" }),
      agent({ id: "pty-2", cwd: "/home/me/works/tmai-core" }),
    ]);
    expect(shells.map((s) => s.id).sort()).toEqual(["pty-1", "pty-2"]);
  });

  it("excludes AI agents (the bash-wrapped Producer + canonical workers)", () => {
    // The Producer and dispatched workers carry canonical AI id schemes /
    // ClaudeCode type — `isAiAgentLoose` excludes them; core kills those.
    const shells = findFooterShells(unit(), [
      agent({ id: "claude:prod", cwd: "/home/me/works/tmai" }),
      agent({ id: "claude:work", cwd: "/home/me/works/tmai", agentType: "ClaudeCode" }),
      agent({ id: "pty-shell", cwd: "/home/me/works/tmai" }),
    ]);
    expect(shells.map((s) => s.id)).toEqual(["pty-shell"]);
  });

  it("excludes shells outside the unit's repos", () => {
    const shells = findFooterShells(unit(), [
      agent({ id: "pty-other", cwd: "/home/me/works/somewhere-else" }),
    ]);
    expect(shells).toHaveLength(0);
  });

  it("normalizes trailing slashes / .git when matching cwd", () => {
    const shells = findFooterShells(unit(), [
      agent({ id: "pty-slash", cwd: "/home/me/works/tmai/" }),
      agent({ id: "pty-git", cwd: "/home/me/works/tmai-core/.git" }),
    ]);
    expect(shells.map((s) => s.id).sort()).toEqual(["pty-git", "pty-slash"]);
  });
});

describe("closeUnitSlot", () => {
  it("POSTs the core close, then kills the unit's footer shells", async () => {
    const agents = [
      agent({ id: "claude:prod", cwd: "/home/me/works/tmai" }),
      agent({ id: "pty-1", cwd: "/home/me/works/tmai" }),
      agent({ id: "pty-2", cwd: "/home/me/works/tmai-core" }),
    ];

    await closeUnitSlot(unit(), agents);

    expect(closeUnitMock).toHaveBeenCalledWith("tmai");
    // Only the two footer shells are killed by the webui (not the Producer).
    const killed = killAgentMock.mock.calls.map((c) => c[0]).sort();
    expect(killed).toEqual(["pty-1", "pty-2"]);
  });

  it("closes before killing — never kills footer bash if the core close fails", async () => {
    closeUnitMock.mockRejectedValue(new Error("API error 404: unknown unit"));
    const agents = [agent({ id: "pty-1", cwd: "/home/me/works/tmai" })];

    await expect(closeUnitSlot(unit(), agents)).rejects.toThrow(/unknown unit/);
    expect(killAgentMock).not.toHaveBeenCalled();
  });

  it("tolerates a footer-kill failure (best-effort) without rejecting", async () => {
    killAgentMock.mockRejectedValue(new Error("already dead"));
    const agents = [agent({ id: "pty-1", cwd: "/home/me/works/tmai" })];

    // A dead/unkillable footer shell must not mask a successful close.
    await expect(closeUnitSlot(unit(), agents)).resolves.toBeUndefined();
    expect(closeUnitMock).toHaveBeenCalledWith("tmai");
  });
});
