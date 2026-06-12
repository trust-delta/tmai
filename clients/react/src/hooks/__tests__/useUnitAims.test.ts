// @vitest-environment jsdom
//
// useUnitAims — the aim-tree poller behind the R panel's ◎ Aims section (the
// aim-tree twin of useUnitObservations / useUnitInventory). We mock
// `api.aims` so each test drives a deterministic response and asserts the
// sibling-shaped contract: `unit = null` parks (no fetch), the initial fetch
// flips `loading`, errors surface without clearing into a fake success, a unit
// change re-fetches, and the 60s poll keeps the last response visible
// (anti-flicker).
//
// Timers stay real and the poll is exercised by capturing the
// `window.setInterval` callback directly — `@testing-library`'s `waitFor`
// cannot make progress under fake timers, and a real 60s wait is not viable in
// a unit test.

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  api: {
    aims: vi.fn(),
  },
}));

import type { AimsResponse } from "@/lib/api";
import { api } from "@/lib/api";
import { useUnitAims } from "../useUnitAims";

function response(unit: string, count: number): AimsResponse {
  return {
    unit,
    composed_at: "2026-06-07T00:00:00Z",
    repos: [
      {
        repo_label: "tmai-core",
        repo_root: "/p/tmai-core",
        primary: true,
        repo_head: null,
        aims: Array.from({ length: count }, (_, i) => ({
          slug: `aim-${i + 1}`,
          aim: `aim ${i + 1}`,
          parent: i === 0 ? null : "aim-1",
          state: "open" as const,
          depends_on: [],
          serves: [],
          related: [],
          body: "",
          drift: null,
          working_delta: null,
          is: [],
        })),
      },
    ],
  };
}

describe("useUnitAims", () => {
  beforeEach(() => {
    vi.mocked(api.aims).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parks on unit=null — no fetch, not loading", () => {
    const { result } = renderHook(() => useUnitAims(null));
    expect(api.aims).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("fetches on a real unit and exposes the response", async () => {
    vi.mocked(api.aims).mockResolvedValue(response("tmai", 3));
    const { result } = renderHook(() => useUnitAims("tmai"));
    expect(result.current.loading).toBe(true);
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(api.aims).toHaveBeenCalledWith("tmai");
    expect(result.current.data?.repos[0]?.aims).toHaveLength(3);
    expect(result.current.error).toBeNull();
  });

  it("surfaces a fetch error without fabricating data", async () => {
    vi.mocked(api.aims).mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useUnitAims("tmai"));
    await waitFor(() => {
      expect(result.current.error?.message).toBe("boom");
    });
    expect(result.current.data).toBeNull();
  });

  it("re-fetches when the unit changes and clears the previous aims", async () => {
    vi.mocked(api.aims).mockImplementation((u: string) =>
      Promise.resolve(response(u, u === "tmai" ? 4 : 1)),
    );
    const { result, rerender } = renderHook(({ u }) => useUnitAims(u), {
      initialProps: { u: "tmai" },
    });
    await waitFor(() => expect(result.current.data?.repos[0]?.aims).toHaveLength(4));

    rerender({ u: "other" });
    // Cleared synchronously on unit change so the old unit's aims are never
    // shown under the new header.
    expect(result.current.data).toBeNull();
    await waitFor(() => expect(result.current.data?.unit).toBe("other"));
    expect(result.current.data?.repos[0]?.aims).toHaveLength(1);
  });

  it("refresh() re-fetches the current unit without clearing (anti-flicker)", async () => {
    vi.mocked(api.aims)
      .mockResolvedValueOnce(response("tmai", 2))
      .mockResolvedValue(response("tmai", 5));
    const { result } = renderHook(() => useUnitAims("tmai"));
    await waitFor(() => expect(result.current.data?.repos[0]?.aims).toHaveLength(2));

    await act(async () => {
      result.current.refresh();
    });
    await waitFor(() => expect(api.aims).toHaveBeenCalledTimes(2));
    // The new response replaces the old in place — never cleared to null mid-refresh.
    expect(result.current.data?.repos[0]?.aims).toHaveLength(5);
  });

  it("refresh() is a no-op while parked (unit=null)", async () => {
    const { result } = renderHook(() => useUnitAims(null));
    await act(async () => {
      result.current.refresh();
    });
    expect(api.aims).not.toHaveBeenCalled();
  });

  it("keeps the last response visible across the 60s poll", async () => {
    const setIntervalSpy = vi.spyOn(window, "setInterval");

    vi.mocked(api.aims).mockResolvedValue(response("tmai", 2));
    const { result } = renderHook(() => useUnitAims("tmai"));
    await waitFor(() => expect(result.current.data?.repos[0]?.aims).toHaveLength(2));

    const tick = setIntervalSpy.mock.calls[0]?.[0] as (() => void) | undefined;
    expect(typeof tick).toBe("function");

    await act(async () => {
      tick?.();
    });
    await waitFor(() => expect(api.aims).toHaveBeenCalledTimes(2));
    // Last response stays visible (anti-flicker) — never cleared on a poll.
    expect(result.current.data?.repos[0]?.aims).toHaveLength(2);
  });
});
