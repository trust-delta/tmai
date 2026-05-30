// @vitest-environment jsdom
//
// usePrDetail — the one-shot PR-detail fetch hooks behind the R₂ viewer
// (#749). We mock the `api` helpers and assert the shared `{ data,
// loading, error }` contract: a `null` arg parks (no fetch), a real PR
// fetches once and exposes the response, errors surface without
// fabricating data, and switching PRs re-fetches + clears the previous
// payload (generation guard).

import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  api: {
    prBody: vi.fn(),
    prLabels: vi.fn(),
    getPrComments: vi.fn(),
    getPrMergeStatus: vi.fn(),
    prDiff: vi.fn(),
    listChecks: vi.fn(),
  },
}));

import { api } from "@/lib/api";
import { usePrBody, usePrChecks, usePrDiff, usePrLabels } from "../usePrDetail";

describe("usePrDetail", () => {
  beforeEach(() => {
    vi.mocked(api.prBody).mockReset();
    vi.mocked(api.prLabels).mockReset();
    vi.mocked(api.prDiff).mockReset();
    vi.mocked(api.listChecks).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parks when the PR is null — no fetch, not loading", () => {
    const { result } = renderHook(() => usePrBody(null, null));
    expect(api.prBody).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("fetches the body once on a real PR and exposes the string", async () => {
    vi.mocked(api.prBody).mockResolvedValue("## hello");
    const { result } = renderHook(() => usePrBody("/p/u", 42));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(api.prBody).toHaveBeenCalledWith("/p/u", 42);
    expect(result.current.data).toBe("## hello");
    expect(result.current.error).toBeNull();
  });

  it("surfaces a fetch error without fabricating data", async () => {
    vi.mocked(api.prLabels).mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => usePrLabels("/p/u", 7));
    await waitFor(() => expect(result.current.error?.message).toBe("boom"));
    expect(result.current.data).toBeNull();
  });

  it("re-fetches when the PR number changes and clears the previous payload", async () => {
    vi.mocked(api.prDiff).mockImplementation((_repo: string, n: number) =>
      Promise.resolve({ repo: "/p/u", pr_number: BigInt(n), patch: `patch-${n}` }),
    );
    const { result, rerender } = renderHook(({ n }) => usePrDiff("/p/u", n), {
      initialProps: { n: 1 },
    });
    await waitFor(() => expect(result.current.data).toBe("patch-1"));

    rerender({ n: 2 });
    // Cleared synchronously on PR change so the old patch is never shown.
    expect(result.current.data).toBeNull();
    await waitFor(() => expect(result.current.data).toBe("patch-2"));
  });

  it("keys CI checks on (repo, branch)", async () => {
    vi.mocked(api.listChecks).mockResolvedValue({
      branch: "feat/x",
      checks: [],
      rollup: "SUCCESS",
    });
    const { result } = renderHook(() => usePrChecks("/p/u", "feat/x"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(api.listChecks).toHaveBeenCalledWith("/p/u", "feat/x");
    expect(result.current.data?.rollup).toBe("SUCCESS");
  });
});
