import { describe, expect, it } from "vitest";
import type { BranchListResponse } from "@/lib/api";

// Reproduces the fetch pattern that BranchGraph uses for its initial load,
// isolated from React. The pre-#470 implementation awaited `Promise.all`
// across four endpoints, so if any one hung (listPrs / listIssues call
// `gh` under the hood and have no client timeout), the top-level
// `.finally` never ran and `loading` stayed true forever, which
// manifested as "Loading branches..." stuck in the Git panel.
//
// The fix fires each call independently and gates `loading` only on
// `listBranches`. This test encodes that contract so a future refactor
// can't silently regress back to an all-or-nothing fetch.

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

// Mirrors BranchGraph's post-fix fetchData shape.
function runFetch(
  listBranches: () => Promise<BranchListResponse>,
  gitGraph: () => Promise<unknown>,
  listPrs: () => Promise<unknown>,
  listIssues: () => Promise<unknown>,
): {
  done: Promise<void>;
  branchesWhenDone: () => BranchListResponse | null;
} {
  let branches: BranchListResponse | null = null;
  gitGraph().catch(() => {});
  listPrs().catch(() => {});
  listIssues().catch(() => {});
  const done = listBranches()
    .then((b) => {
      branches = b;
    })
    .catch(() => {});
  return { done, branchesWhenDone: () => branches };
}

describe("BranchGraph initial load resilience (#470)", () => {
  it("resolves once listBranches completes, even with 10 branches", async () => {
    const list = makeBranchList(10);
    const { done, branchesWhenDone } = runFetch(
      () => Promise.resolve(list),
      () => Promise.resolve({ commits: [], total_count: 0 }),
      () => Promise.resolve({}),
      () => Promise.resolve([]),
    );
    await done;
    expect(branchesWhenDone()?.branches).toHaveLength(10);
  });

  it("does not wait for listPrs / listIssues — a hang on either must not stall loading", async () => {
    const list = makeBranchList(10);
    // `gh` CLI can block on auth / rate limits with no client-side timeout;
    // the loading state must not wait for those optional fetches.
    const hanging = new Promise<never>(() => {});
    const { done, branchesWhenDone } = runFetch(
      () => Promise.resolve(list),
      () => Promise.resolve({ commits: [], total_count: 0 }),
      () => hanging,
      () => hanging,
    );
    await done;
    expect(branchesWhenDone()?.branches).toHaveLength(10);
  });

  it("does not wait for gitGraph — a hang on the graph endpoint must not stall loading", async () => {
    const list = makeBranchList(10);
    const hanging = new Promise<never>(() => {});
    const { done, branchesWhenDone } = runFetch(
      () => Promise.resolve(list),
      () => hanging,
      () => Promise.resolve({}),
      () => Promise.resolve([]),
    );
    await done;
    expect(branchesWhenDone()?.branches).toHaveLength(10);
  });

  it("branches remain null when listBranches itself rejects (panel shows empty, not stuck)", async () => {
    const { done, branchesWhenDone } = runFetch(
      () => Promise.reject(new Error("network")),
      () => Promise.resolve({ commits: [], total_count: 0 }),
      () => Promise.resolve({}),
      () => Promise.resolve([]),
    );
    await done;
    expect(branchesWhenDone()).toBeNull();
  });
});
