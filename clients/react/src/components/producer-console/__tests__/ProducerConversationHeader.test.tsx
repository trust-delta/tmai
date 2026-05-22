// @vitest-environment jsdom
//
// ProducerConversationHeader — the co-visible ctx% readout + Handoff &
// restart trigger shown ABOVE the terminal while conversing with the
// Producer. It reuses ProducerCtxHeader for the readout (which fetches
// the orchestrator settings), so we mock that fetch; the button fires
// the App-level lifted `trigger` after a confirm.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSnapshot } from "@/lib/api";
import { ProducerConversationHeader } from "../ProducerConversationHeader";

const getOrchestratorSettingsMock = vi.fn();

// Preserve the actual module (the shared `findProducerForUnit` resolver
// reaches `normalizeGitDir` through it) and override only the fetch the
// ctx readout makes on mount.
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      getOrchestratorSettings: (project?: string) => getOrchestratorSettingsMock(project),
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
});

describe("ProducerConversationHeader", () => {
  it("renders the ctx% readout and an enabled Handoff button when a Producer is resolved", () => {
    const producer = agent({
      id: "claude:abc",
      cwd: "/home/u/proj",
      git_common_dir: "/home/u/proj/.git",
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

    expect(screen.getByText(/ctx:/)).toBeTruthy();
    expect(screen.getByText("71%")).toBeTruthy();
    const btn = screen.getByRole("button", { name: /Handoff & restart/ });
    expect(btn).toHaveProperty("disabled", false);
  });

  it("disables the Handoff button when no Producer matches the unit", () => {
    render(
      <ProducerConversationHeader
        agents={[]}
        currentProjectPath="/home/u/proj"
        unitName="proj"
        trigger={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

    const btn = screen.getByRole("button", { name: /Handoff & restart/ });
    expect(btn).toHaveProperty("disabled", true);
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

    confirmSpy.mockRestore();
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

    confirmSpy.mockRestore();
  });
});
