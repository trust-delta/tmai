// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProducerRoster } from "@/components/project/ProducerRoster";
import type { AgentSnapshot } from "@/lib/api";

// Minimal AgentSnapshot stub matching the current wire shape. Only the
// fields the Producer-rooted roster reads need to be meaningful; the rest
// are filled with inert defaults.
function stubAgent(overrides: Partial<AgentSnapshot> = {}): AgentSnapshot {
  return {
    id: "claude:agent",
    target: "claude:agent",
    agent_type: "ClaudeCode",
    title: "",
    cwd: "/repo",
    display_cwd: "/repo",
    display_name: "claude:agent",
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

const UNIT_PATH = "/repo";

// The unit's single live Producer: claude-scheme, repo-root (not a worktree).
const producer = stubAgent({
  id: "claude:prod-1",
  target: "claude:prod-1",
  is_worktree: false,
  git_common_dir: "/repo/.git",
  cwd: "/repo",
});

// A worker: a worktree clone under the same repo.
const worker = stubAgent({
  id: "claude:work-1",
  target: "claude:work-1",
  is_worktree: true,
  git_common_dir: "/repo/.git",
  cwd: "/repo/.claude/worktrees/feat-x",
  git_branch: "feat-x",
});

describe("ProducerRoster", () => {
  it("renders the unit's Producer as the headline and addresses it on click", () => {
    const onSelect = vi.fn();
    render(
      <ProducerRoster
        agents={[producer, worker]}
        unitPath={UNIT_PATH}
        selectedTarget={null}
        onSelect={onSelect}
      />,
    );

    // The PRODUCER badge makes "who am I talking to" legible.
    expect(screen.getByText("Producer")).toBeTruthy();
    // Selecting the headline addresses the Producer (§A) via its target.
    fireEvent.click(screen.getByRole("button", { name: /Producer/ }));
    expect(onSelect).toHaveBeenCalledWith("claude:prod-1");
  });

  it("renders workers as subordinate child rows beneath the Producer", () => {
    render(
      <ProducerRoster
        agents={[producer, worker]}
        unitPath={UNIT_PATH}
        selectedTarget={null}
        onSelect={() => {}}
      />,
    );

    const producerBtn = screen.getByRole("button", { name: /Producer/ });
    const workerBtn = screen.getByRole("button", { name: /feat-x/ });
    expect(producerBtn).toBeTruthy();
    expect(workerBtn).toBeTruthy();

    // The worker is NOT a second Producer headline — it carries no badge.
    expect(workerBtn.textContent).not.toContain("Producer");

    // Document order: the worker row renders *beneath* the Producer headline.
    expect(
      producerBtn.compareDocumentPosition(workerBtn) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("keeps a worker row click-selectable (emergency direct-address)", () => {
    const onSelect = vi.fn();
    render(
      <ProducerRoster
        agents={[producer, worker]}
        unitPath={UNIT_PATH}
        selectedTarget={null}
        onSelect={onSelect}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /feat-x/ }));
    expect(onSelect).toHaveBeenCalledWith("claude:work-1");
  });

  it("degrades honestly when no single Producer resolves (zero)", () => {
    const onSelect = vi.fn();
    // Only a worktree agent — `findProducerForUnit` resolves nothing.
    render(
      <ProducerRoster
        agents={[worker]}
        unitPath={UNIT_PATH}
        selectedTarget={null}
        onSelect={onSelect}
      />,
    );

    // Honest note, no fabricated headline.
    expect(screen.getByText(/no single producer resolved/i)).toBeTruthy();
    expect(screen.queryByText("Producer")).toBeNull();

    // The agent is still rendered and click-selectable (no crash).
    fireEvent.click(screen.getByRole("button", { name: /feat-x/ }));
    expect(onSelect).toHaveBeenCalledWith("claude:work-1");
  });

  it("degrades honestly when the Producer is ambiguous (two candidates)", () => {
    const producerB = stubAgent({
      id: "claude:prod-2",
      target: "claude:prod-2",
      is_worktree: false,
      git_common_dir: "/repo/.git",
      cwd: "/repo",
    });
    render(
      <ProducerRoster
        agents={[producer, producerB]}
        unitPath={UNIT_PATH}
        selectedTarget={null}
        onSelect={() => {}}
      />,
    );

    expect(screen.getByText(/no single producer resolved/i)).toBeTruthy();
    expect(screen.queryByText("Producer")).toBeNull();
  });
});
