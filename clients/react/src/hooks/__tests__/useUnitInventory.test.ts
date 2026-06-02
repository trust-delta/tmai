// @vitest-environment jsdom
//
// useUnitInventory — the cross-record in-play inventory poller behind the R
// panel's 📦 In-play section (the inventory twin of useUnitIssues). We mock
// `api.unitInventory` so each test drives a deterministic response and
// asserts the sibling-shaped contract: `unit = null` parks (no fetch), the
// initial fetch flips `loading`, errors surface without clearing into a fake
// success, a unit change re-fetches, and the 60s poll keeps the last
// response visible (anti-flicker).
//
// Timers stay real and the poll is exercised by capturing the
// `window.setInterval` callback directly — `@testing-library`'s `waitFor`
// cannot make progress under fake timers, and a real 60s wait is not viable
// in a unit test.

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  api: {
    unitInventory: vi.fn(),
  },
}));

import type { UnitInventoryResponse } from "@/lib/api";
import { api } from "@/lib/api";
import { useUnitInventory } from "../useUnitInventory";

function response(unit: string, decisionCount: number): UnitInventoryResponse {
  return {
    unit,
    today: "2026-06-03",
    decision_count: decisionCount,
    approach_count: decisionCount,
    decisions: Array.from({ length: decisionCount }, (_, i) => ({
      slug: `2026-01-0${i + 1}-decision-${i + 1}`,
      display: `decision-${i + 1}`,
      frontmatter_status: "accepted",
      serving_health: "healthy",
      running_count: 1,
      serving: [
        {
          slug: `2026-02-0${i + 1}-approach-${i + 1}`,
          display: `approach-${i + 1}`,
          projected_status: "running",
          work_residual: { outstanding: [], count: 0 },
          liveness: { stalled: false, last_fact: "2026-06-01", days_since: 2n },
        },
      ],
    })),
    unanchored_approaches: [],
  };
}

describe("useUnitInventory", () => {
  beforeEach(() => {
    vi.mocked(api.unitInventory).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parks on unit=null — no fetch, not loading", () => {
    const { result } = renderHook(() => useUnitInventory(null));
    expect(api.unitInventory).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("fetches on a real unit and exposes the response", async () => {
    vi.mocked(api.unitInventory).mockResolvedValue(response("tmai", 2));
    const { result } = renderHook(() => useUnitInventory("tmai"));
    expect(result.current.loading).toBe(true);
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(api.unitInventory).toHaveBeenCalledWith("tmai");
    expect(result.current.data?.decisions).toHaveLength(2);
    expect(result.current.error).toBeNull();
  });

  it("surfaces a fetch error without fabricating data", async () => {
    vi.mocked(api.unitInventory).mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useUnitInventory("tmai"));
    await waitFor(() => {
      expect(result.current.error?.message).toBe("boom");
    });
    expect(result.current.data).toBeNull();
  });

  it("re-fetches when the unit changes and clears the previous inventory", async () => {
    vi.mocked(api.unitInventory).mockImplementation((u: string) =>
      Promise.resolve(response(u, u === "tmai" ? 3 : 1)),
    );
    const { result, rerender } = renderHook(({ u }) => useUnitInventory(u), {
      initialProps: { u: "tmai" },
    });
    await waitFor(() => expect(result.current.data?.decisions).toHaveLength(3));

    rerender({ u: "other" });
    // Cleared synchronously on unit change so the old unit's inventory is
    // never shown under the new header.
    expect(result.current.data).toBeNull();
    await waitFor(() => expect(result.current.data?.unit).toBe("other"));
    expect(result.current.data?.decisions).toHaveLength(1);
  });

  it("keeps the last response visible across the 60s poll", async () => {
    // Spy only — `vi.spyOn` calls through, so `waitFor`'s own internal
    // `setInterval` polling still works (a `mockImplementation` here would
    // deadlock waitFor). We read the captured callback and fire it by hand
    // instead of waiting a real 60s.
    const setIntervalSpy = vi.spyOn(window, "setInterval");

    vi.mocked(api.unitInventory).mockResolvedValue(response("tmai", 2));
    const { result } = renderHook(() => useUnitInventory("tmai"));
    await waitFor(() => expect(result.current.data?.decisions).toHaveLength(2));

    const tick = setIntervalSpy.mock.calls[0]?.[0] as (() => void) | undefined;
    expect(typeof tick).toBe("function");

    await act(async () => {
      tick?.();
    });
    await waitFor(() => expect(api.unitInventory).toHaveBeenCalledTimes(2));
    // Last response stays visible (anti-flicker) — never cleared on a poll.
    expect(result.current.data?.decisions).toHaveLength(2);
  });
});
