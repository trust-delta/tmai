// @vitest-environment jsdom
//
// TerminalSessionHeader (C3) — model + cwd + ctx% for a worker session,
// resolved from the shared `AgentSnapshot`. Tested in isolation (not
// through TerminalPanel, which mounts xterm).

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AgentSnapshot } from "@/lib/api";
import { agentIdShort, TerminalSessionHeader } from "../TerminalSessionHeader";

function agent(overrides: Partial<AgentSnapshot> = {}): AgentSnapshot {
  return {
    id: "claude:11112222333344445555",
    target: "pty:abc",
    agent_type: "ClaudeCode",
    title: "worker",
    cwd: "/home/me/works/tmai-wt-attn-ui",
    display_cwd: "~/works/tmai-wt-attn-ui",
    display_name: "attention-ui",
    detection_source: "http_hook",
    git_branch: "feat/x",
    git_dirty: false,
    is_worktree: true,
    git_common_dir: "/home/me/works/tmai/.git",
    worktree_name: "tmai-wt-attn-ui",
    worktree_base_branch: "main",
    effort_level: null,
    active_subagents: 0,
    compaction_count: 0,
    pty_session_id: "abc",
    is_virtual: false,
    team_info: null,
    model_id: "claude-sonnet-4-6",
    model_display_name: "sonnet-4.6",
    ...overrides,
  };
}

describe("agentIdShort", () => {
  it("keeps the scheme and trims the id to 8 chars", () => {
    expect(agentIdShort("provisional:abcd1234efgh")).toBe("provisional:abcd1234");
    expect(agentIdShort("noscheme")).toBe("noscheme");
  });
});

describe("TerminalSessionHeader", () => {
  it("shows the model display name + cwd", () => {
    render(<TerminalSessionHeader agentId="claude:11112222333344445555" agent={agent()} />);
    expect(screen.getByText("sonnet-4.6")).toBeTruthy();
    expect(screen.getByText("~/works/tmai-wt-attn-ui")).toBeTruthy();
  });

  it("falls back to model_id when there is no display name", () => {
    render(
      <TerminalSessionHeader
        agentId="claude:x"
        agent={agent({ model_display_name: null, model_id: "claude-opus-4-8" })}
      />,
    );
    expect(screen.getByText("claude-opus-4-8")).toBeTruthy();
  });

  it("renders a ctx% readout coloured by fill (warn ≥75, danger ≥90)", () => {
    const { rerender } = render(
      <TerminalSessionHeader
        agentId="claude:x"
        agent={agent({ ctx_usage: { used: 160000n, total: 200000n, pct: 80, updated_at: "t" } })}
      />,
    );
    const warn = screen.getByText("80%");
    expect(warn.parentElement?.className).toMatch(/text-warning/);

    rerender(
      <TerminalSessionHeader
        agentId="claude:x"
        agent={agent({ ctx_usage: { used: 184000n, total: 200000n, pct: 92, updated_at: "t" } })}
      />,
    );
    const danger = screen.getByText("92%");
    expect(danger.parentElement?.className).toMatch(/text-destructive/);
  });

  it("degrades to the id only when no snapshot is resolved", () => {
    render(<TerminalSessionHeader agentId="provisional:deadbeef0000" agent={undefined} />);
    expect(screen.getByText("provisional:deadbeef")).toBeTruthy();
    // No model / cwd / ctx rows when the snapshot is absent.
    expect(screen.queryByText("sonnet-4.6")).toBeNull();
  });
});
