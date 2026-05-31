// @vitest-environment jsdom
//
// useIssueDetail — the one-shot issue-detail fetch hook behind the R₂
// issue viewer. We mock `api.getIssueDetail` and assert the shared `{
// data, loading, error }` contract: a `null` arg parks (no fetch), a real
// issue fetches once and exposes the response, errors surface without
// fabricating data, and switching issues re-fetches + clears the previous
// payload (generation guard) — mirroring the usePrDetail tests.

import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IssueDetail } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: {
    getIssueDetail: vi.fn(),
  },
}));

import { api } from "@/lib/api";
import { useIssueDetail } from "../useIssueDetail";

function detail(n: number): IssueDetail {
  return {
    number: n,
    title: `Issue ${n}`,
    state: "open",
    url: `https://github.com/o/r/issues/${n}`,
    body: `body ${n}`,
    labels: [],
    assignees: [],
    created_at: "2026-05-20T10:00:00Z",
    updated_at: "2026-05-21T12:00:00Z",
    comments: [],
  };
}

describe("useIssueDetail", () => {
  beforeEach(() => {
    vi.mocked(api.getIssueDetail).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parks when the issue is null — no fetch, not loading", () => {
    const { result } = renderHook(() => useIssueDetail(null, null));
    expect(api.getIssueDetail).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("fetches the detail once on a real issue and exposes the response", async () => {
    vi.mocked(api.getIssueDetail).mockResolvedValue(detail(42));
    const { result } = renderHook(() => useIssueDetail("/p/u", 42));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(api.getIssueDetail).toHaveBeenCalledWith("/p/u", 42);
    expect(result.current.data?.number).toBe(42);
    expect(result.current.error).toBeNull();
  });

  it("surfaces a fetch error without fabricating data", async () => {
    vi.mocked(api.getIssueDetail).mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useIssueDetail("/p/u", 7));
    await waitFor(() => expect(result.current.error?.message).toBe("boom"));
    expect(result.current.data).toBeNull();
  });

  it("re-fetches when the issue number changes and clears the previous payload", async () => {
    vi.mocked(api.getIssueDetail).mockImplementation((_repo: string, n: number) =>
      Promise.resolve(detail(n)),
    );
    const { result, rerender } = renderHook(({ n }) => useIssueDetail("/p/u", n), {
      initialProps: { n: 1 },
    });
    await waitFor(() => expect(result.current.data?.number).toBe(1));

    rerender({ n: 2 });
    // Cleared synchronously on issue change so the old detail is never shown.
    expect(result.current.data).toBeNull();
    await waitFor(() => expect(result.current.data?.number).toBe(2));
  });
});
