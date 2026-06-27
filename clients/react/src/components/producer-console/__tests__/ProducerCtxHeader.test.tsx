// @vitest-environment jsdom
//
// ProducerCtxHeader — ctx% display strip + auto-handoff threshold
// readout. Mocks the orchestrator-settings fetch so each test can
// drive a deterministic threshold value, and constructs minimal
// AgentSnapshot fixtures that match the Handoff & restart filter
// (claude: id-scheme + !is_worktree + cwd resolves to the unit).

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSnapshot } from "@/lib/api";
import {
  formatThousands,
  ProducerCtxHeader,
  renderBar,
  thresholdColorClass,
} from "../ProducerCtxHeader";

const getProducerSettingsMock = vi.fn();

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      getProducerSettings: (project?: string) => getProducerSettingsMock(project),
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
    is_producer: partial.is_producer,
    ctx_usage: partial.ctx_usage,
  };
}

function orchestratorFixture(threshold: number) {
  return {
    enabled: true,
    role: "",
    rules: { branch: "", merge: "", review: "", custom: "" },
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

describe("ProducerCtxHeader — pure helpers", () => {
  it("formatThousands rounds bigint to nearest thousand with k suffix", () => {
    expect(formatThousands(142_000n)).toBe("142k");
    expect(formatThousands(199_500n)).toBe("200k");
    expect(formatThousands(0n)).toBe("0k");
  });

  it("renderBar gives proportional 10-wide segments rounded to nearest tenth", () => {
    expect(renderBar(0)).toEqual({ filled: 0, empty: 10, chars: "░░░░░░░░░░" });
    expect(renderBar(71)).toEqual({ filled: 7, empty: 3, chars: "▮▮▮▮▮▮▮░░░" });
    expect(renderBar(100)).toEqual({ filled: 10, empty: 0, chars: "▮▮▮▮▮▮▮▮▮▮" });
    // Clamp out-of-range
    expect(renderBar(-10).filled).toBe(0);
    expect(renderBar(150).filled).toBe(10);
  });

  // Migrated off raw palette onto semantic tokens (zinc→muted-foreground,
  // amber→warning, red→destructive) — see scripts/theme-codemod.mjs.
  it("thresholdColorClass flips muted / warning / destructive across the boundary", () => {
    expect(thresholdColorClass(50, 75)).toMatch(/muted-foreground/);
    expect(thresholdColorClass(66, 75)).toMatch(/warning/);
    expect(thresholdColorClass(74, 75)).toMatch(/warning/);
    expect(thresholdColorClass(75, 75)).toMatch(/destructive/);
    expect(thresholdColorClass(95, 75)).toMatch(/destructive/);
    // Disabled threshold keeps the readout muted regardless of pct
    expect(thresholdColorClass(99, 0)).toMatch(/muted-foreground/);
    // null pct (no ctx_usage yet) → muted
    expect(thresholdColorClass(null, 75)).toMatch(/muted-foreground/);
  });
});

describe("ProducerCtxHeader — rendering", () => {
  beforeEach(() => {
    getProducerSettingsMock.mockReset();
  });

  it("renders ctx Nk / Nk (pct%) from fixture ctx_usage", async () => {
    getProducerSettingsMock.mockResolvedValue(orchestratorFixture(75));
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
      <ProducerCtxHeader
        agents={[producer]}
        currentProjectPath="/home/u/proj"
        onOpenSettings={vi.fn()}
      />,
    );
    expect(screen.getByText(/ctx:/)).toBeTruthy();
    expect(screen.getByText("142k")).toBeTruthy();
    expect(screen.getByText("200k")).toBeTruthy();
    expect(screen.getByText("71%")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText(/auto-handoff at 75%/)).toBeTruthy();
    });
  });

  it("renders the 10-segment bar matching the pct", () => {
    getProducerSettingsMock.mockResolvedValue(orchestratorFixture(75));
    const producer = agent({
      id: "claude:abc",
      ctx_usage: {
        used: 60_000n,
        total: 200_000n,
        pct: 30,
        updated_at: "2026-05-15T00:00:00Z",
      },
    });
    render(
      <ProducerCtxHeader
        agents={[producer]}
        currentProjectPath="/home/u/proj"
        onOpenSettings={vi.fn()}
      />,
    );
    // 30% → 3 filled + 7 empty
    expect(screen.getByText("▮▮▮░░░░░░░")).toBeTruthy();
  });

  it("shows placeholder when no Producer matches the unit", async () => {
    getProducerSettingsMock.mockResolvedValue(orchestratorFixture(75));
    render(
      <ProducerCtxHeader agents={[]} currentProjectPath="/home/u/proj" onOpenSettings={vi.fn()} />,
    );
    expect(screen.getByText(/ctx: — \/ —/)).toBeTruthy();
    // Threshold still appears so the row keeps fixed height
    await waitFor(() => {
      expect(screen.getByText(/auto-handoff at 75%/)).toBeTruthy();
    });
  });

  it("shows placeholder when Producer exists but ctx_usage is absent", async () => {
    getProducerSettingsMock.mockResolvedValue(orchestratorFixture(75));
    const producer = agent({ id: "claude:abc", ctx_usage: null });
    render(
      <ProducerCtxHeader
        agents={[producer]}
        currentProjectPath="/home/u/proj"
        onOpenSettings={vi.fn()}
      />,
    );
    expect(screen.getByText(/ctx: — \/ —/)).toBeTruthy();
  });

  it("labels the threshold as 'disabled' when set to 0", async () => {
    getProducerSettingsMock.mockResolvedValue(orchestratorFixture(0));
    render(
      <ProducerCtxHeader agents={[]} currentProjectPath="/home/u/proj" onOpenSettings={vi.fn()} />,
    );
    await waitFor(() => {
      expect(screen.getByText(/auto-handoff: disabled/)).toBeTruthy();
    });
  });

  it("⚙ click invokes onOpenSettings", async () => {
    getProducerSettingsMock.mockResolvedValue(orchestratorFixture(75));
    const onOpenSettings = vi.fn();
    render(
      <ProducerCtxHeader
        agents={[]}
        currentProjectPath="/home/u/proj"
        onOpenSettings={onOpenSettings}
      />,
    );
    fireEvent.click(screen.getByLabelText(/Open settings/));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("does not pick a worktree-Producer (is_worktree gate)", () => {
    getProducerSettingsMock.mockResolvedValue(orchestratorFixture(75));
    const worktreeProducer = agent({
      id: "claude:wt",
      is_worktree: true,
      ctx_usage: {
        used: 100_000n,
        total: 200_000n,
        pct: 50,
        updated_at: "2026-05-15T00:00:00Z",
      },
    });
    render(
      <ProducerCtxHeader
        agents={[worktreeProducer]}
        currentProjectPath="/home/u/proj"
        onOpenSettings={vi.fn()}
      />,
    );
    expect(screen.getByText(/ctx: — \/ —/)).toBeTruthy();
  });
});
