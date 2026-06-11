// @vitest-environment jsdom
//
// useUnitSlack — the per-repo slack-ore terrain poller behind the AimPane's
// SLACK face (issue #809). We mock `api.unitSlack` so each test drives a
// deterministic response and asserts the sibling-shaped contract (mirrors
// useUnitPrs): `unit = null` parks (no fetch), the initial fetch flips
// `loading`, errors surface without clearing into a fake success, a unit
// change re-fetches, the 60s poll keeps the last response visible
// (anti-flicker), and `refresh()` (the capture box's post-POST path,
// mirrors useUnitAims) re-fetches in place.
//
// Timers stay real and the poll is exercised by capturing the
// `window.setInterval` callback directly — `@testing-library`'s `waitFor`
// cannot make progress under fake timers, and a real 60s wait is not viable
// in a unit test.

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  api: {
    unitSlack: vi.fn(),
  },
}));

import type { UnitSlackResponse } from "@/lib/api";
import { api } from "@/lib/api";
import { useUnitSlack } from "../useUnitSlack";

function response(unit: string, oreCount: number): UnitSlackResponse {
  return {
    unit,
    repos: [
      {
        repo_path: `/home/u/works/${unit}`,
        repo_label: unit,
        primary: true,
        ores: Array.from({ length: oreCount }, (_, i) => ({
          ticket: `2026-06-11-10000${i}`,
          captured_at: `2026-06-11T10:00:0${i}`,
          body: `ore ${i + 1}`,
          quoted_by: [],
        })),
      },
    ],
  };
}

describe("useUnitSlack", () => {
  beforeEach(() => {
    vi.mocked(api.unitSlack).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parks on unit=null — no fetch, not loading", () => {
    const { result } = renderHook(() => useUnitSlack(null));
    expect(api.unitSlack).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("fetches on a real unit and exposes the response", async () => {
    vi.mocked(api.unitSlack).mockResolvedValue(response("tmai", 2));
    const { result } = renderHook(() => useUnitSlack("tmai"));
    expect(result.current.loading).toBe(true);
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(api.unitSlack).toHaveBeenCalledWith("tmai");
    expect(result.current.data?.repos[0]?.ores).toHaveLength(2);
    expect(result.current.error).toBeNull();
  });

  it("surfaces a fetch error without fabricating data", async () => {
    vi.mocked(api.unitSlack).mockRejectedValue(new Error("API error 404: no route"));
    const { result } = renderHook(() => useUnitSlack("tmai"));
    await waitFor(() => {
      expect(result.current.error?.message).toBe("API error 404: no route");
    });
    expect(result.current.data).toBeNull();
  });

  it("re-fetches when the unit changes and clears the previous list", async () => {
    vi.mocked(api.unitSlack).mockImplementation((u: string) =>
      Promise.resolve(response(u, u === "tmai" ? 3 : 1)),
    );
    const { result, rerender } = renderHook(({ u }) => useUnitSlack(u), {
      initialProps: { u: "tmai" },
    });
    await waitFor(() => expect(result.current.data?.repos[0]?.ores).toHaveLength(3));

    rerender({ u: "other" });
    // Cleared synchronously on unit change so the old unit's terrain is
    // never shown under the new header.
    expect(result.current.data).toBeNull();
    await waitFor(() => expect(result.current.data?.unit).toBe("other"));
    expect(result.current.data?.repos[0]?.ores).toHaveLength(1);
  });

  it("keeps the last response visible across the 60s poll", async () => {
    // Spy only — `vi.spyOn` calls through, so `waitFor`'s own internal
    // `setInterval` polling still works (a `mockImplementation` here
    // would deadlock waitFor). We read the captured callback and fire
    // it by hand instead of waiting a real 60s.
    const setIntervalSpy = vi.spyOn(window, "setInterval");

    vi.mocked(api.unitSlack).mockResolvedValue(response("tmai", 2));
    const { result } = renderHook(() => useUnitSlack("tmai"));
    await waitFor(() => expect(result.current.data?.repos[0]?.ores).toHaveLength(2));

    const tick = setIntervalSpy.mock.calls[0]?.[0] as (() => void) | undefined;
    expect(typeof tick).toBe("function");

    await act(async () => {
      tick?.();
    });
    await waitFor(() => expect(api.unitSlack).toHaveBeenCalledTimes(2));
    // Last response stays visible (anti-flicker) — never cleared on a poll.
    expect(result.current.data?.repos[0]?.ores).toHaveLength(2);
  });

  it("refresh() re-fetches the current unit without clearing (anti-flicker)", async () => {
    vi.mocked(api.unitSlack)
      .mockResolvedValueOnce(response("tmai", 2))
      .mockResolvedValue(response("tmai", 3));
    const { result } = renderHook(() => useUnitSlack("tmai"));
    await waitFor(() => expect(result.current.data?.repos[0]?.ores).toHaveLength(2));

    await act(async () => {
      result.current.refresh();
    });
    await waitFor(() => expect(api.unitSlack).toHaveBeenCalledTimes(2));
    // The new response replaces the old in place — never cleared to null mid-refresh.
    expect(result.current.data?.repos[0]?.ores).toHaveLength(3);
  });

  it("refresh() is a no-op while parked (unit=null)", async () => {
    const { result } = renderHook(() => useUnitSlack(null));
    await act(async () => {
      result.current.refresh();
    });
    expect(api.unitSlack).not.toHaveBeenCalled();
  });
});
