// @vitest-environment jsdom
//
// Shead (S6) test — the aim-console's own per-session header bar, replacing
// the borrowed ProducerConversationHeader inside SessionPane.
//
//   Producer variant: status dot · name · model · ctx bar with the
//   auto-handoff threshold marker ┊ · pct · ⤺ handoff & restart (the
//   App-lifted ritual `trigger`, confirm flow preserved) · ⚙ · ✕ kill.
//   Worker variant: dot · name · model · repo/cwd · ✕ kill — violet accent.
//
// `getOrchestratorSettings` (the threshold fetch) and `killAgent` are
// mocked; the rest of the api stays real.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type AgentSnapshot, api, type OrchestratorSettings } from "@/lib/api";
import { Shead } from "../Shead";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      getOrchestratorSettings: vi.fn(),
      killAgent: vi.fn(),
    },
  };
});

const getOrchestratorSettings = vi.mocked(api.getOrchestratorSettings);
const killAgent = vi.mocked(api.killAgent);

function stubAgent(partial: Partial<AgentSnapshot> & { id: string }): AgentSnapshot {
  return {
    id: partial.id,
    target: partial.target ?? partial.id,
    agent_type: partial.agent_type ?? "ClaudeCode",
    title: partial.title ?? partial.id,
    cwd: partial.cwd ?? "/home/u/tmai",
    display_cwd: partial.display_cwd ?? "~/tmai",
    display_name: partial.display_name ?? partial.id,
    detection_source: partial.detection_source ?? "IpcSocket",
    git_branch: partial.git_branch ?? "main",
    git_dirty: partial.git_dirty ?? false,
    is_worktree: partial.is_worktree ?? false,
    git_common_dir: partial.git_common_dir ?? "/home/u/tmai/.git",
    unit: partial.unit,
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
    model_id: partial.model_id,
    model_display_name: partial.model_display_name,
    ctx_usage: partial.ctx_usage ?? null,
  };
}

const PRODUCER = stubAgent({
  id: "claude:prod",
  display_name: "Producer",
  model_display_name: "opus-4.8",
  unit: "tmai",
  ctx_usage: { used: 114000n, total: 200000n, pct: 57, updated_at: "2026-06-11T00:00:00Z" },
});

const WORKER = stubAgent({
  id: "claude:w1",
  display_name: "attention-ui",
  model_display_name: "sonnet-4.6",
  is_worktree: true,
  git_common_dir: "/home/u/tmai/.git",
  display_cwd: "../tmai-wt-attn-ui",
  ctx_usage: { used: 82000n, total: 200000n, pct: 41, updated_at: "2026-06-11T00:00:00Z" },
});

function renderShead(overrides: Partial<Parameters<typeof Shead>[0]> = {}) {
  const props = {
    agent: PRODUCER,
    isProducer: true,
    unitName: "tmai" as string | null,
    currentProjectPath: "/home/u/tmai" as string | null,
    trigger: vi.fn(() => Promise.resolve()),
    onOpenSettings: vi.fn(),
    ...overrides,
  };
  render(<Shead {...props} />);
  return props;
}

beforeEach(() => {
  getOrchestratorSettings.mockReset();
  killAgent.mockReset();
  getOrchestratorSettings.mockResolvedValue({
    auto_handoff_threshold_pct: 75,
  } as OrchestratorSettings);
  killAgent.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Shead — Producer variant", () => {
  it("renders dot · name · model · ctx bar (with ┊ threshold marker) · pct", async () => {
    const { container } = render(
      <Shead
        agent={PRODUCER}
        isProducer
        unitName="tmai"
        currentProjectPath="/home/u/tmai"
        trigger={vi.fn(() => Promise.resolve())}
        onOpenSettings={vi.fn()}
      />,
    );
    const head = screen.getByTestId("ac-shead-producer");
    expect(head.className).toContain("ac-who-p");
    expect(screen.getByText("Producer")).toBeTruthy();
    expect(screen.getByText("opus-4.8")).toBeTruthy();
    expect(screen.getByText("57%")).toBeTruthy();
    // 10-segment bar: 57% → 6 filled.
    const bar = container.querySelector(".bar");
    expect(bar?.textContent).toContain("▮");
    // The ┊ threshold marker lands once the threshold fetch (75%) resolves.
    await waitFor(() => expect(bar?.textContent).toContain("┊"));
    expect(screen.getByText("auto 75%")).toBeTruthy();
  });

  it("fires the handoff ritual trigger behind the confirm flow", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const props = renderShead();
    fireEvent.click(screen.getByRole("button", { name: /handoff & restart/i }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(props.trigger).toHaveBeenCalledWith("tmai", { trigger: "manual" });
  });

  it("does NOT trigger when the confirm is declined", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const props = renderShead();
    fireEvent.click(screen.getByRole("button", { name: /handoff & restart/i }));
    expect(props.trigger).not.toHaveBeenCalled();
  });

  it("opens settings via ⚙ and kills via ✕", () => {
    const props = renderShead();
    fireEvent.click(screen.getByRole("button", { name: "Open settings — auto-handoff threshold" }));
    expect(props.onOpenSettings).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Kill agent" }));
    expect(killAgent).toHaveBeenCalledWith("claude:prod");
  });

  it("renders 'auto off' and no ┊ marker when the threshold is 0 (disabled)", async () => {
    getOrchestratorSettings.mockResolvedValue({
      auto_handoff_threshold_pct: 0,
    } as OrchestratorSettings);
    const { container } = render(
      <Shead
        agent={PRODUCER}
        isProducer
        unitName="tmai"
        currentProjectPath="/home/u/tmai"
        trigger={vi.fn(() => Promise.resolve())}
        onOpenSettings={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByText("auto off")).toBeTruthy());
    expect(container.querySelector(".bar")?.textContent).not.toContain("┊");
  });
});

describe("Shead — worker variant", () => {
  it("renders dot · name · model · repo/cwd with the violet accent and kill only", () => {
    renderShead({ agent: WORKER, isProducer: false });
    const head = screen.getByTestId("ac-shead-worker");
    expect(head.className).toContain("ac-who-w");
    expect(screen.getByText("attention-ui")).toBeTruthy();
    expect(screen.getByText("sonnet-4.6")).toBeTruthy();
    expect(screen.getByText(/repo tmai · main · \.\.\/tmai-wt-attn-ui/)).toBeTruthy();
    // No handoff ritual, no settings — the worker bar carries kill only.
    expect(screen.queryByRole("button", { name: /handoff & restart/i })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Open settings — auto-handoff threshold" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Kill agent" }));
    expect(killAgent).toHaveBeenCalledWith("claude:w1");
    // The worker variant never fetches the (Producer-only) threshold.
    expect(getOrchestratorSettings).not.toHaveBeenCalled();
  });
});
