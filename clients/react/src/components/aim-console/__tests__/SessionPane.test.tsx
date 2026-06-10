// @vitest-environment jsdom
//
// SessionPane (S3) test. The Session pane is a faithful reproduction of the
// mock's `.session` section (session tabs + shead + term), wiring the EXISTING
// console infra into the aim-console:
//   - tabs ← the live agent list (Producer via `findProducerForUnit` + the
//     unit's workers);
//   - shead ← ProducerConversationHeader for the Producer (the Handoff &
//     restart ritual), a plain model/cwd bar for a worker;
//   - term ← TerminalPanel (live PTY) / PreviewPanel (no live PTY).
//
// TerminalPanel / PreviewPanel are heavy (xterm + the PTY plane), so they are
// stubbed to the agentId they receive — the pane logic under test is the tab
// list, the LOCAL session selection, and the shead split. `api` is mocked so
// ProducerConversationHeader's settings fetch never hits the network.

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AgentSnapshot } from "@/lib/api";
import { SessionPane } from "../SessionPane";

vi.mock("@/components/terminal/TerminalPanel", () => ({
  TerminalPanel: ({ agentId }: { agentId: string }) => (
    <div data-testid="ac-term-terminal">{agentId}</div>
  ),
}));
vi.mock("@/components/agent/PreviewPanel", () => ({
  PreviewPanel: ({ agentId }: { agentId: string }) => (
    <div data-testid="ac-term-preview">{agentId}</div>
  ),
}));
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      // Park the threshold fetch in flight — the pane tests don't assert on
      // the ctx readout, and this keeps the network out of jsdom.
      getOrchestratorSettings: () => new Promise<never>(() => {}),
    },
  };
});

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
  };
}

// A `[[unit]]` spanning tmai + tmai-core: the Producer at the primary repo, a
// worker in each repo (the secondary-repo worker carries `unit` so it still
// scopes in), plus two agents that must NOT appear — a bash terminal (not an
// AI agent) and a worker from a different unit.
const PRODUCER = stubAgent({
  id: "claude:prod",
  display_name: "Producer",
  is_worktree: false,
  git_common_dir: "/home/u/tmai/.git",
  unit: "tmai",
  model_display_name: "opus-4.8",
  pty_session_id: "pty-prod",
});
const WORKER_UI = stubAgent({
  id: "claude:w1",
  display_name: "attention-ui",
  is_worktree: true,
  git_common_dir: "/home/u/tmai/.git",
  unit: "tmai",
  model_display_name: "sonnet-4.6",
  pty_session_id: "pty-w1",
});
const WORKER_DRIFT = stubAgent({
  id: "claude:w2",
  display_name: "drift-cycle",
  is_worktree: true,
  git_common_dir: "/home/u/tmai-core/.git",
  unit: "tmai",
  model_id: "opus-4.8",
  pty_session_id: null, // no live PTY → PreviewPanel
  attention: "started",
});
const BASH_TERM = stubAgent({
  id: "bash:term1",
  agent_type: { Custom: "bash" },
  display_name: "sh-1",
  unit: "tmai",
});
const OTHER_UNIT = stubAgent({
  id: "claude:other",
  display_name: "infra-worker",
  is_worktree: true,
  git_common_dir: "/home/u/infra/.git",
  unit: "infra",
});

const ALL_AGENTS = [PRODUCER, WORKER_UI, WORKER_DRIFT, BASH_TERM, OTHER_UNIT];

function renderPane(overrides: Partial<Parameters<typeof SessionPane>[0]> = {}) {
  const props = {
    agents: ALL_AGENTS,
    unitName: "tmai" as string | null,
    currentProjectPath: "/home/u/tmai" as string | null,
    trigger: vi.fn(),
    onOpenSettings: vi.fn(),
    ...overrides,
  };
  render(<SessionPane {...props} />);
  return props;
}

describe("SessionPane — S3 Session conversation", () => {
  it("renders one tab per session agent — Producer (PROD) + this unit's workers (WRK)", () => {
    renderPane();
    const tabs = screen.getAllByRole("tab");
    // Producer first, then workers sorted by name (attention-ui, drift-cycle).
    expect(tabs.map((t) => t.textContent)).toEqual([
      expect.stringContaining("Producer"),
      expect.stringContaining("attention-ui"),
      expect.stringContaining("drift-cycle"),
    ]);
    // Role badges: PROD on the Producer, WRK on a worker.
    expect(screen.getByRole("tab", { name: /Producer/ }).textContent).toContain("PROD");
    expect(screen.getByRole("tab", { name: /attention-ui/ }).textContent).toContain("WRK");
  });

  it("excludes non-AI terminals and agents from other units", () => {
    renderPane();
    expect(screen.queryByRole("tab", { name: /sh-1/ })).toBeNull();
    expect(screen.queryByRole("tab", { name: /infra-worker/ })).toBeNull();
  });

  it("defaults to the Producer and switches the term when another tab is selected", () => {
    renderPane();
    // Default selection = Producer (a live PTY → TerminalPanel).
    expect(screen.getByTestId("ac-term-terminal").textContent).toBe("claude:prod");

    // A worker with no live PTY → PreviewPanel.
    fireEvent.click(screen.getByRole("tab", { name: /drift-cycle/ }));
    expect(screen.queryByTestId("ac-term-terminal")).toBeNull();
    expect(screen.getByTestId("ac-term-preview").textContent).toBe("claude:w2");

    // A worker with a live PTY → TerminalPanel again.
    fireEvent.click(screen.getByRole("tab", { name: /attention-ui/ }));
    expect(screen.getByTestId("ac-term-terminal").textContent).toBe("claude:w1");
  });

  it("renders the Handoff & restart shead for the Producer, a plain bar for a worker", () => {
    renderPane();
    // Producer selected by default → the ProducerConversationHeader shead
    // carries the Handoff & restart ritual.
    expect(screen.getByRole("button", { name: /Handoff & restart/ })).toBeTruthy();

    // Switch to a worker → no Handoff ritual; plain model/cwd bar instead.
    fireEvent.click(screen.getByRole("tab", { name: /attention-ui/ }));
    expect(screen.queryByRole("button", { name: /Handoff & restart/ })).toBeNull();
    expect(screen.getByText("sonnet-4.6")).toBeTruthy();
  });

  it("reserves the bottom strip for the S4 bash footer (does not fill the whole pane)", () => {
    renderPane();
    expect(screen.getByTestId("aim-session-footer-reserve")).toBeTruthy();
  });

  it("renders an empty state when the unit has no live sessions", () => {
    renderPane({ agents: [] });
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.getByText(/No active session for this unit/)).toBeTruthy();
  });
});
