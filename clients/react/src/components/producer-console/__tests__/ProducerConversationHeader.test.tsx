// @vitest-environment jsdom
//
// ProducerConversationHeader — the SINGLE compact bar shown ABOVE the
// terminal while conversing with the Producer. Density refinement
// (2026-05-23): it merges what used to be three stacked bars, so it now
// carries a status dot (from `attention`) + name + Kill (subsuming
// AgentActions) alongside the compact ctx% readout (no `ctx:` label, no
// `used / total` text — those move to a title tooltip) and the Handoff &
// restart trigger. The ctx readout reuses ProducerCtxHeader's helpers
// and fetches the orchestrator settings, so we mock that fetch; the
// Handoff button fires the App-level lifted `trigger` after a confirm,
// and Kill calls `api.killAgent`.

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSnapshot } from "@/lib/api";
import { ProducerConversationHeader } from "../ProducerConversationHeader";

const getOrchestratorSettingsMock = vi.fn();
const killAgentMock = vi.fn();

// Preserve the actual module (the shared `findProducerForUnit` resolver
// reaches `normalizeGitDir` through it) and override only the fetch the
// ctx readout makes on mount and the kill the Kill button fires.
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      getOrchestratorSettings: (project?: string) => getOrchestratorSettingsMock(project),
      killAgent: (target: string) => killAgentMock(target),
    },
  };
});

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
    is_orchestrator: partial.is_orchestrator,
    ctx_usage: partial.ctx_usage,
  };
}

function orchestratorFixture(threshold: number) {
  return {
    enabled: true,
    role: "",
    rules: { branch: "", merge: "", review: "", custom: "" },
    notify: {},
    guardrails: { max_ci_retries: 0, max_review_loops: 0, escalate_to_human_after: 0 },
    auto_action_templates: {},
    pr_monitor_enabled: false,
    pr_monitor_interval_secs: 60,
    pr_monitor_exclude_authors: [],
    pr_monitor_scope: "current_project",
    inject_state_snapshot: false,
    auto_handoff_threshold_pct: threshold,
    is_project_override: false,
    dispatch: {},
  };
}

beforeEach(() => {
  getOrchestratorSettingsMock.mockReset();
  getOrchestratorSettingsMock.mockResolvedValue(orchestratorFixture(75));
  killAgentMock.mockReset();
  killAgentMock.mockResolvedValue(undefined);
});

// Restore any `vi.spyOn(window, "confirm")` after each test so a failing
// assertion can't leak the confirm stub into later tests.
afterEach(() => {
  vi.restoreAllMocks();
});

describe("ProducerConversationHeader", () => {
  it("renders the status dot, name, compact ctx% + bar, auto@N%, Kill, ⚙ and an enabled Handoff button", async () => {
    const producer = agent({
      id: "claude:abc",
      display_name: "tmai",
      cwd: "/home/u/proj",
      git_common_dir: "/home/u/proj/.git",
      attention: "halted",
      ctx_usage: {
        used: 142_000n,
        total: 200_000n,
        pct: 71,
        updated_at: "2026-05-15T00:00:00Z",
      },
    });
    render(
      <ProducerConversationHeader
        agents={[producer]}
        currentProjectPath="/home/u/proj"
        unitName="proj"
        trigger={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

    // Status dot — coloured + word-in-title from `attention`.
    expect(screen.getByTitle("Halted")).toBeTruthy();
    // Name.
    expect(screen.getByText("tmai")).toBeTruthy();
    // Compact ctx readout: percent + bar, no `ctx:` label / used-total text.
    expect(screen.getByText("71%")).toBeTruthy();
    expect(screen.queryByText(/ctx:\s*142k/)).toBeNull();
    // The full used/total rides in a title tooltip instead.
    expect(screen.getByTitle("ctx: 142k / 200k (71%)")).toBeTruthy();
    // Compact threshold readout — resolves after the orchestrator-settings fetch.
    expect(await screen.findByText("auto@75%")).toBeTruthy();
    // Kill + settings + Handoff.
    expect(screen.getByRole("button", { name: "Kill" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Open settings/ })).toBeTruthy();
    const btn = screen.getByRole("button", { name: /Handoff & restart/ });
    expect(btn).toHaveProperty("disabled", false);
  });

  it("defaults the status dot to Active when attention is null", () => {
    const producer = agent({
      id: "claude:abc",
      cwd: "/home/u/proj",
      git_common_dir: "/home/u/proj/.git",
      attention: null,
    });
    render(
      <ProducerConversationHeader
        agents={[producer]}
        currentProjectPath="/home/u/proj"
        unitName="proj"
        trigger={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

    expect(screen.getByTitle("Active")).toBeTruthy();
  });

  it("disables Handoff and Kill when no Producer matches the unit", () => {
    render(
      <ProducerConversationHeader
        agents={[]}
        currentProjectPath="/home/u/proj"
        unitName="proj"
        trigger={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /Handoff & restart/ })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByRole("button", { name: "Kill" })).toHaveProperty("disabled", true);
  });

  it("fires window.confirm + trigger(unit, manual) when the Handoff button is accepted", () => {
    const trigger = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const producer = agent({
      id: "claude:abc",
      cwd: "/home/u/proj",
      git_common_dir: "/home/u/proj/.git",
    });
    render(
      <ProducerConversationHeader
        agents={[producer]}
        currentProjectPath="/home/u/proj"
        unitName="proj"
        trigger={trigger}
        onOpenSettings={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Handoff & restart/ }));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveBeenCalledWith("proj", { trigger: "manual" });
  });

  it("does NOT fire the trigger when the confirm is denied", () => {
    const trigger = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const producer = agent({
      id: "claude:abc",
      cwd: "/home/u/proj",
      git_common_dir: "/home/u/proj/.git",
    });
    render(
      <ProducerConversationHeader
        agents={[producer]}
        currentProjectPath="/home/u/proj"
        unitName="proj"
        trigger={trigger}
        onOpenSettings={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Handoff & restart/ }));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(trigger).not.toHaveBeenCalled();
  });

  it("calls api.killAgent(producer.target) when Kill is clicked", () => {
    const producer = agent({
      id: "claude:abc",
      target: "claude:abc",
      cwd: "/home/u/proj",
      git_common_dir: "/home/u/proj/.git",
    });
    render(
      <ProducerConversationHeader
        agents={[producer]}
        currentProjectPath="/home/u/proj"
        unitName="proj"
        trigger={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Kill" }));
    expect(killAgentMock).toHaveBeenCalledWith("claude:abc");
  });
});
