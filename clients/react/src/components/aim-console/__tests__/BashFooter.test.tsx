// @vitest-environment jsdom
//
// BashFooter (S4) test — the docked bash footer of the aim-console Session
// pane. The footer reuses the existing shell-terminal primitives (issue
// #799): `api.spawnPty({ command: "bash", cwd })` to open a PTY, the live
// agent list to DISCOVER + re-attach an already-running bash, and
// `TerminalPanel` to render it. So the unit under test is the footer's own
// logic — collapse/expand, LAZY spawn on first activation (NOT on mount),
// re-attach over duplicate, ad-hoc add/close (kill on close), and split — with
// `spawnPty` / `killAgent` / `TerminalPanel` stubbed.

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type AgentSnapshot, api } from "@/lib/api";
import { BashFooter } from "../BashFooter";

// TerminalPanel is heavy (xterm + the PTY plane); stub it to the agentId it
// receives so we can assert WHICH session a pane attaches to.
vi.mock("@/components/terminal/TerminalPanel", () => ({
  TerminalPanel: ({ agentId }: { agentId: string }) => (
    <div data-testid="ac-footer-terminal">{agentId}</div>
  ),
}));

// Mock only the two spawn/kill side effects; keep `isAiAgentLoose` /
// `normalizeGitDir` real (the footer's re-attach discovery depends on them).
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      spawnPty: vi.fn(),
      killAgent: vi.fn(),
    },
  };
});

const spawnPty = vi.mocked(api.spawnPty);
const killAgent = vi.mocked(api.killAgent);

function bashAgent(partial: Partial<AgentSnapshot> & { id: string }): AgentSnapshot {
  return {
    id: partial.id,
    target: partial.target ?? partial.id,
    // A plain shell — `isAiAgentLoose` must return false so the footer treats
    // it as re-attachable (the bash-wrapped Producer / workers are excluded).
    agent_type: partial.agent_type ?? { Custom: "bash" },
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
    pty_session_id: partial.pty_session_id ?? partial.target ?? partial.id,
    send_capability: partial.send_capability ?? "Ipc",
    is_virtual: partial.is_virtual ?? false,
    team_info: partial.team_info ?? null,
    attention: partial.attention ?? null,
    model_id: partial.model_id,
    model_display_name: partial.model_display_name,
  };
}

const REPOS = [
  { path: "/home/u/tmai", primary: true },
  { path: "/home/u/tmai-core", primary: false },
];

function renderFooter(overrides: Partial<Parameters<typeof BashFooter>[0]> = {}) {
  const props = {
    repos: REPOS,
    primaryPath: "/home/u/tmai" as string | null,
    agents: [] as AgentSnapshot[],
    ...overrides,
  };
  render(<BashFooter {...props} />);
  return props;
}

beforeEach(() => {
  spawnPty.mockReset();
  killAgent.mockReset();
  spawnPty.mockResolvedValue({ session_id: "sess-new", pid: 1, command: "bash" });
  killAgent.mockResolvedValue(undefined);
});

describe("BashFooter — S4 docked bash footer", () => {
  it("mounts COLLAPSED with one tab per repo and spawns NOTHING (lazy hygiene)", () => {
    renderFooter();
    const footer = screen.getByTestId("aim-bash-footer");
    expect(footer.getAttribute("data-open")).toBe("false");
    // One tab per repo (primary first), no terminal mounted, no PTY spawned.
    expect(screen.getByTestId("aim-bash-tab-tmai")).toBeTruthy();
    expect(screen.getByTestId("aim-bash-tab-tmai-core")).toBeTruthy();
    expect(screen.queryByTestId("ac-footer-terminal")).toBeNull();
    expect(spawnPty).not.toHaveBeenCalled();
  });

  it("expands on the carat and lazy-spawns ONLY the active repo's bash", async () => {
    renderFooter();
    fireEvent.click(screen.getByRole("button", { name: "Expand bash footer" }));
    expect(screen.getByTestId("aim-bash-footer").getAttribute("data-open")).toBe("true");
    await waitFor(() =>
      expect(spawnPty).toHaveBeenCalledWith({ command: "bash", cwd: "/home/u/tmai" }),
    );
    // The secondary repo is NOT surfaced, so its shell is not spawned.
    expect(spawnPty).toHaveBeenCalledTimes(1);
  });

  it("lazy-spawns a repo's bash on its FIRST tab activation (cwd = that repo)", async () => {
    renderFooter();
    fireEvent.click(within(screen.getByTestId("aim-bash-tab-tmai-core")).getByRole("tab"));
    await waitFor(() =>
      expect(spawnPty).toHaveBeenCalledWith({ command: "bash", cwd: "/home/u/tmai-core" }),
    );
    expect(spawnPty).toHaveBeenCalledTimes(1);
  });

  it("RE-ATTACHES to an already-running bash for the repo's cwd (no duplicate spawn)", async () => {
    const existing = bashAgent({
      id: "bash:existing",
      target: "term-core",
      cwd: "/home/u/tmai-core",
      git_common_dir: "/home/u/tmai-core/.git",
    });
    renderFooter({ agents: [existing] });
    fireEvent.click(within(screen.getByTestId("aim-bash-tab-tmai-core")).getByRole("tab"));
    // The pane attaches to the existing session — and no new shell is spawned.
    expect((await screen.findByTestId("ac-footer-terminal")).textContent).toBe("term-core");
    expect(spawnPty).not.toHaveBeenCalled();
  });

  it("re-spawns a repo tab whose stored session has DIED (stale id gone from agents)", async () => {
    const live = bashAgent({
      id: "bash:core",
      target: "term-core",
      cwd: "/home/u/tmai-core",
      git_common_dir: "/home/u/tmai-core/.git",
    });
    const { rerender } = render(
      <BashFooter repos={REPOS} primaryPath="/home/u/tmai" agents={[live]} />,
    );
    // First activation re-attaches to the live shell (no spawn).
    fireEvent.click(within(screen.getByTestId("aim-bash-tab-tmai-core")).getByRole("tab"));
    expect((await screen.findByTestId("ac-footer-terminal")).textContent).toBe("term-core");
    expect(spawnPty).not.toHaveBeenCalled();

    // The bash exits → its agent drops off the live roster.
    rerender(<BashFooter repos={REPOS} primaryPath="/home/u/tmai" agents={[]} />);

    // Re-activating the (non-closeable) repo tab must NOT stay stuck on the dead
    // session — it clears the stale id and spawns a fresh bash for that cwd.
    fireEvent.click(within(screen.getByTestId("aim-bash-tab-tmai-core")).getByRole("tab"));
    await waitFor(() =>
      expect(spawnPty).toHaveBeenCalledWith({ command: "bash", cwd: "/home/u/tmai-core" }),
    );
  });

  it("shows a running dot for a repo that already has a live bash", () => {
    const existing = bashAgent({
      id: "bash:existing",
      target: "term-core",
      cwd: "/home/u/tmai-core",
      git_common_dir: "/home/u/tmai-core/.git",
    });
    renderFooter({ agents: [existing] });
    // tmai-core has a live shell → running dot; tmai does not.
    expect(
      within(screen.getByTestId("aim-bash-tab-tmai-core")).queryByTitle(
        "bash running in this repo",
      ),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId("aim-bash-tab-tmai")).queryByTitle("bash running in this repo"),
    ).toBeNull();
  });

  it("adds an ad-hoc sh-N tab on `+` and spawns it in the primary repo", async () => {
    renderFooter();
    fireEvent.click(screen.getByRole("button", { name: "New ad-hoc terminal" }));
    expect(screen.getByTestId("aim-bash-tab-sh-1")).toBeTruthy();
    await waitFor(() =>
      expect(spawnPty).toHaveBeenCalledWith({ command: "bash", cwd: "/home/u/tmai" }),
    );
    // A second `+` → sh-2.
    fireEvent.click(screen.getByRole("button", { name: "New ad-hoc terminal" }));
    expect(screen.getByTestId("aim-bash-tab-sh-2")).toBeTruthy();
  });

  it("closes an ad-hoc tab and KILLS its PTY (no stranded orphan)", async () => {
    const spawned = bashAgent({ id: "bash:s1", target: "sess-1", cwd: "/home/u/tmai" });
    spawnPty.mockResolvedValue({ session_id: "sess-1", pid: 2, command: "bash" });
    renderFooter({ agents: [spawned] });
    fireEvent.click(screen.getByRole("button", { name: "New ad-hoc terminal" }));
    // The ad-hoc spawn resolves and the pane attaches to it.
    expect((await screen.findByTestId("ac-footer-terminal")).textContent).toBe("sess-1");
    fireEvent.click(screen.getByRole("button", { name: "Close sh-1" }));
    expect(screen.queryByTestId("aim-bash-tab-sh-1")).toBeNull();
    expect(killAgent).toHaveBeenCalledWith("sess-1");
  });

  it("split view renders two terminals side by side (active + partner)", async () => {
    const a = bashAgent({
      id: "bash:a",
      target: "term-a",
      cwd: "/home/u/tmai",
      git_common_dir: "/home/u/tmai/.git",
    });
    const b = bashAgent({
      id: "bash:b",
      target: "term-b",
      cwd: "/home/u/tmai-core",
      git_common_dir: "/home/u/tmai-core/.git",
    });
    renderFooter({ agents: [a, b] });
    fireEvent.click(screen.getByRole("button", { name: "Toggle split view" }));
    const terminals = await screen.findAllByTestId("ac-footer-terminal");
    expect(terminals).toHaveLength(2);
    expect(terminals.map((t) => t.textContent).sort()).toEqual(["term-a", "term-b"]);
    // The wrap carries the `.split` modifier; both panes get a header.
    const footer = screen.getByTestId("aim-bash-footer");
    expect(footer.querySelector(".ac-ftwrap.split")).toBeTruthy();
  });

  it("disables split with fewer than two tabs", () => {
    renderFooter({ repos: [], primaryPath: "/home/u/solo" });
    expect(
      (screen.getByRole("button", { name: "Toggle split view" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("falls back to a single primary-path tab when the unit has no repos", () => {
    renderFooter({ repos: [], primaryPath: "/home/u/solo" });
    expect(screen.getByTestId("aim-bash-tab-solo")).toBeTruthy();
    // And `+` still works off the primary path.
    expect(
      (screen.getByRole("button", { name: "New ad-hoc terminal" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("disables `+` when there is no primary repo to spawn into", () => {
    renderFooter({ repos: [], primaryPath: null });
    expect(
      (screen.getByRole("button", { name: "New ad-hoc terminal" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
