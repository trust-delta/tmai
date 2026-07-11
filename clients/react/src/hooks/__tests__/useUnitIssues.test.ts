// @vitest-environment jsdom
//
// useUnitIssues — the unified cross-repo open-issue poller behind the R
// panel's 📋 Issues section (the issues twin of useUnitPrs). We mock
// `api.unitIssues` so each test drives a deterministic response and
// asserts the sibling-shaped contract: `unit = null` parks (no fetch),
// the initial fetch flips `loading`, errors surface without clearing into
// a fake success, a unit change re-fetches, and the 60s poll keeps the
// last response visible (anti-flicker).
//
// Timers stay real and the poll is exercised by capturing the
// `window.setInterval` callback directly — `@testing-library`'s
// `waitFor` cannot make progress under fake timers, and a real 60s
// wait is not viable in a unit test.

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  api: {
    unitIssues: vi.fn(),
  },
}));

import type { UnitIssuesResponse } from "@/lib/api";
import { api } from "@/lib/api";
import { useUnitIssues } from "../useUnitIssues";

function response(unit: string, issueCount: number): UnitIssuesResponse {
  return {
    unit,
    repos: [
      {
        repo_path: `/home/u/works/${unit}`,
        repo_label: unit,
        primary: true,
        issues: Array.from({ length: issueCount }, (_, i) => ({
          number: BigInt(i + 1),
          title: `Issue ${i + 1}`,
          state: "open",
          url: `https://github.com/o/${unit}/issues/${i + 1}`,
          labels: [],
          assignees: [],
          created_at: null,
          closed_at: null,
          last_synced_at: null,
        })),
      },
    ],
  };
}

describe("useUnitIssues", () => {
  beforeEach(() => {
    vi.mocked(api.unitIssues).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parks on unit=null — no fetch, not loading", () => {
    const { result } = renderHook(() => useUnitIssues(null));
    expect(api.unitIssues).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("fetches on a real unit and exposes the response", async () => {
    vi.mocked(api.unitIssues).mockResolvedValue(response("tmai", 2));
    const { result } = renderHook(() => useUnitIssues("tmai"));
    expect(result.current.loading).toBe(true);
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(api.unitIssues).toHaveBeenCalledWith("tmai");
    expect(result.current.data?.repos[0].issues).toHaveLength(2);
    expect(result.current.error).toBeNull();
  });

  it("surfaces a fetch error without fabricating data", async () => {
    vi.mocked(api.unitIssues).mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useUnitIssues("tmai"));
    await waitFor(() => {
      expect(result.current.error?.message).toBe("boom");
    });
    expect(result.current.data).toBeNull();
  });

  it("re-fetches when the unit changes and clears the previous list", async () => {
    vi.mocked(api.unitIssues).mockImplementation((u: string) =>
      Promise.resolve(response(u, u === "tmai" ? 3 : 1)),
    );
    const { result, rerender } = renderHook(({ u }) => useUnitIssues(u), {
      initialProps: { u: "tmai" },
    });
    await waitFor(() => expect(result.current.data?.repos[0].issues).toHaveLength(3));

    rerender({ u: "other" });
    // Cleared synchronously on unit change so the old unit's list is
    // never shown under the new header.
    expect(result.current.data).toBeNull();
    await waitFor(() => expect(result.current.data?.unit).toBe("other"));
    expect(result.current.data?.repos[0].issues).toHaveLength(1);
  });

  it("keeps the last response visible across the 60s poll", async () => {
    // Spy only — `vi.spyOn` calls through, so `waitFor`'s own internal
    // `setInterval` polling still works (a `mockImplementation` here
    // would deadlock waitFor). We read the captured callback and fire
    // it by hand instead of waiting a real 60s.
    const setIntervalSpy = vi.spyOn(window, "setInterval");

    vi.mocked(api.unitIssues).mockResolvedValue(response("tmai", 2));
    const { result } = renderHook(() => useUnitIssues("tmai"));
    await waitFor(() => expect(result.current.data?.repos[0].issues).toHaveLength(2));

    const tick = setIntervalSpy.mock.calls[0]?.[0] as (() => void) | undefined;
    expect(typeof tick).toBe("function");

    await act(async () => {
      tick?.();
    });
    await waitFor(() => expect(api.unitIssues).toHaveBeenCalledTimes(2));
    // Last response stays visible (anti-flicker) — never cleared on a poll.
    expect(result.current.data?.repos[0].issues).toHaveLength(2);
  });
});
