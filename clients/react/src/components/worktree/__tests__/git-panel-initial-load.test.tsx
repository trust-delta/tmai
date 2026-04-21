// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BranchListResponse } from "@/lib/api";

// Component-level test for the Git panel initial load (#1).
//
// Reproduces the bug: listBranches was fired last in fetchData, so on startup
// — when multiple components (useAgents, useWorktrees, etc.) send concurrent
// requests — listBranches could be queued behind slower in-flight requests
// and never dispatch. "Loading branches..." remained visible indefinitely.
//
// The fix: listBranches fires first in fetchData, claiming a connection slot
// before the supplementary requests. These tests render the actual BranchGraph
// component to protect against regressions in the real code path.

// ---- shared call-order tracker (vi.hoisted so it's available in vi.mock factories) ----
const { callOrder } = vi.hoisted(() => ({ callOrder: [] as string[] }));

// ---- mock @/lib/api ----
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();

  function makeBranchList(n: number): BranchListResponse {
    const branches = ["main", ...Array.from({ length: n - 1 }, (_, i) => `feat/b${i}`)];
    return {
      default_branch: "main",
      current_branch: "main",
      branches,
      parents: {},
      ahead_behind: {},
      remote_tracking: {},
      remote_only_branches: [],
      last_fetch: null,
      last_commit_times: {},
    };
  }

  const hanging = new Promise<never>(() => {});

  return {
    ...actual,
    api: {
      // ---- tracked: listBranches resolves immediately ----
      listBranches: () => {
        callOrder.push("listBranches");
        return Promise.resolve(makeBranchList(10));
      },
      // ---- tracked: gitGraph hangs (simulates slow computation / pool saturation) ----
      gitGraph: () => {
        callOrder.push("gitGraph");
        return hanging;
      },
      // ---- tracked: listPrs hangs (gh CLI stall) ----
      listPrs: () => {
        callOrder.push("listPrs");
        return hanging;
      },
      // ---- tracked: listIssues hangs ----
      listIssues: () => {
        callOrder.push("listIssues");
        return hanging;
      },
      // ActionPanel fires these on mount; keep them hanging so they don't affect assertions
      listChecks: () => hanging,
      gitDiffStat: () => hanging,
      listAgents: () => hanging,
      listWorktrees: () => hanging,
      // Fallback: any other api call hangs rather than throwing
      attentionCount: () => hanging,
    },
    statusName: actual.statusName,
  };
});

// ---- mock @/lib/sse-provider ----
vi.mock("@/lib/sse-provider", () => ({
  useSSE: vi.fn(),
  SSEProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ---- mock @/components/layout/ConfirmDialog ----
vi.mock("@/components/layout/ConfirmDialog", () => ({
  useConfirm: () => vi.fn(),
  ConfirmProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { BranchGraph } from "../BranchGraph";

describe("Git panel initial load with 10 branches (#1)", () => {
  const defaultProps = {
    projectPath: "/test/repo",
    projectName: "test-repo",
    worktrees: [],
    agents: [],
    onFocusAgent: vi.fn(),
  };

  it("dismisses 'Loading branches...' and renders branch list once listBranches resolves", async () => {
    callOrder.length = 0;
    render(<BranchGraph {...defaultProps} />);

    // Loading state should be visible initially
    expect(screen.getByText("Loading branches...")).toBeTruthy();

    // After listBranches resolves, loading disappears and branches are rendered
    await waitFor(() => {
      expect(screen.queryByText("Loading branches...")).toBeNull();
    });

    // Branch names should be visible (makeBranchList(10) produces feat/b0..feat/b8)
    expect(screen.getByText("feat/b0")).toBeTruthy();
  });

  it("listBranches fires before supplementary requests (connection-slot priority)", async () => {
    callOrder.length = 0;
    render(<BranchGraph {...defaultProps} />);

    await waitFor(() => {
      expect(screen.queryByText("Loading branches...")).toBeNull();
    });

    // listBranches MUST be the first request initiated (#1 fix)
    expect(callOrder[0]).toBe("listBranches");
  });

  it("loading clears even when gitGraph / listPrs / listIssues never resolve (pool saturation)", async () => {
    callOrder.length = 0;
    render(<BranchGraph {...defaultProps} />);

    // gitGraph / listPrs / listIssues are hanging — loading must still clear
    await waitFor(() => {
      expect(screen.queryByText("Loading branches...")).toBeNull();
    });

    // Branch list populated despite supplementary requests still in-flight
    expect(screen.getByText("feat/b0")).toBeTruthy();
  });
});
