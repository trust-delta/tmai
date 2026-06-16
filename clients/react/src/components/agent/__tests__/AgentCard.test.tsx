// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AgentCard } from "@/components/agent/AgentCard";
import type { AgentSnapshot } from "@/lib/api";

// Producer detection rides the `is_producer` wire field (DR
// `2026-05-16-producer-identity-and-operator-addressing` §B). Before #836
// this card read the stale `is_orchestrator`, which the engine never
// serves, so the badge + accent highlight never rendered for the Producer.
function stubAgent(overrides: Partial<AgentSnapshot> = {}): AgentSnapshot {
  return {
    id: "claude:prod-1",
    target: "claude:prod-1",
    agent_type: "ClaudeCode",
    title: "",
    cwd: "/repo",
    display_cwd: "/repo",
    display_name: "claude:prod-1",
    detection_source: "HttpHook",
    git_branch: null,
    git_dirty: false,
    is_worktree: false,
    git_common_dir: "/repo/.git",
    worktree_name: null,
    worktree_base_branch: null,
    effort_level: null,
    active_subagents: 0,
    compaction_count: 0,
    pty_session_id: null,
    send_capability: "PtyInject",
    is_virtual: false,
    team_info: null,
    attention: null,
    ...overrides,
  };
}

describe("AgentCard — Producer badge + accent", () => {
  it("renders the PROD badge and accent highlight for the Producer (is_producer: true)", () => {
    const { container } = render(<AgentCard agent={stubAgent({ is_producer: true })} />);

    expect(screen.getByText("PROD")).toBeTruthy();
    // The accent highlight is applied to the outer card button.
    const button = container.querySelector("button");
    expect(button?.className).toContain("bg-primary/[0.04]");
  });

  it("omits the badge and accent for a same-unit worker (is_producer: false)", () => {
    const { container } = render(<AgentCard agent={stubAgent({ is_producer: false })} />);

    expect(screen.queryByText("PROD")).toBeNull();
    const button = container.querySelector("button");
    expect(button?.className).not.toContain("bg-primary/[0.04]");
  });
});
