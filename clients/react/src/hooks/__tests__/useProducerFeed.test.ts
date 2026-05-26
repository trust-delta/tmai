// @vitest-environment jsdom
//
// useProducerFeed — the producer-feed status poller behind the Producer
// console's "Check deltas ▸" button + top-bar chip. We mock
// `api.producerFeed` so each test drives a deterministic response and
// asserts the sibling-shaped contract: `unit = null` parks (no fetch),
// the initial fetch flips `loading`, errors surface without fabricating
// data, a unit change re-fetches, and the 60s poll keeps the last
// response visible (anti-flicker).
//
// IMPORTANT — why this does NOT mirror useUnitPrs.test's call-through
// `vi.spyOn(window, "setInterval")` + `waitFor`:
//
//   A call-through spy schedules a REAL `window.setInterval(fetchOnce,
//   60_000)`. That timer (and any `fetchOnce` it or `waitFor`'s own
//   internal polling leaves in flight) can outlive the file's jsdom
//   environment; when the pending `fetchOnce` resolves AFTER teardown,
//   its `setLoading(false)` runs against a `window` that no longer
//   exists → "ReferenceError: window is not defined", which vitest
//   surfaces as an unhandled rejection → process exit 1 *even though
//   every assertion passed*. This actually red-lit PR #738's CI (stack:
//   `fetchOnce src/hooks/useProducerFeed.ts:73`) while the local run —
//   shorter, so the race didn't trip — looked green.
//
//   The invariant is therefore: no real `window.setInterval` may survive
//   the test, and no `fetchOnce` may be left in flight at teardown. We
//   mock `setInterval` to *record* the poll callback and return a dummy
//   id (nothing real scheduled), mock `clearInterval` to a no-op, and
//   flush the async fetch deterministically with `act` (no `waitFor`,
//   which itself leans on a real `setInterval`).

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  api: {
    producerFeed: vi.fn(),
  },
}));

import type { ProducerFeedStatus } from "@/lib/api";
import { api } from "@/lib/api";
import { useProducerFeed } from "../useProducerFeed";

function status(unit: string, pending: boolean): ProducerFeedStatus {
  return {
    unit,
    producer_address: `${unit}.producer`,
    tip: pending ? 3n : 0n,
    last_served_cursor: 0n,
    has_pending_delta: pending ? true : undefined,
  };
}

// Poll callbacks the hook hands to `window.setInterval`, captured WITHOUT
// scheduling a real timer (see the file header for why this matters).
let pollCallbacks: Array<() => void>;

// Drain pending microtasks (the `await api.producerFeed(...)` resolution
// and the React state update it triggers) inside an `act` boundary, so
// nothing is left in flight when the test returns.
const flush = () => act(async () => undefined);

beforeEach(() => {
  vi.mocked(api.producerFeed).mockReset();
  pollCallbacks = [];
  vi.spyOn(window, "setInterval").mockImplementation(((cb: () => void) => {
    pollCallbacks.push(cb);
    // Dummy id — no real timer scheduled, so nothing survives teardown.
    return 1 as unknown as ReturnType<typeof window.setInterval>;
  }) as typeof window.setInterval);
  vi.spyOn(window, "clearInterval").mockImplementation(
    (() => undefined) as typeof window.clearInterval,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useProducerFeed", () => {
  it("parks on unit=null — no fetch, not loading, no timer", () => {
    const { result } = renderHook(() => useProducerFeed(null));
    expect(api.producerFeed).not.toHaveBeenCalled();
    expect(pollCallbacks).toHaveLength(0);
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("fetches on a real unit and exposes the response", async () => {
    vi.mocked(api.producerFeed).mockResolvedValue(status("tmai", true));
    const { result } = renderHook(() => useProducerFeed("tmai"));
    expect(result.current.loading).toBe(true);
    await flush();
    expect(api.producerFeed).toHaveBeenCalledWith("tmai");
    expect(result.current.loading).toBe(false);
    expect(result.current.data?.has_pending_delta).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("surfaces a fetch error without fabricating data", async () => {
    vi.mocked(api.producerFeed).mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useProducerFeed("tmai"));
    await flush();
    expect(result.current.error?.message).toBe("boom");
    expect(result.current.data).toBeNull();
  });

  it("re-fetches when the unit changes and clears the previous status", async () => {
    vi.mocked(api.producerFeed).mockImplementation((u: string) =>
      Promise.resolve(status(u, u === "tmai")),
    );
    const { result, rerender } = renderHook(({ u }) => useProducerFeed(u), {
      initialProps: { u: "tmai" },
    });
    await flush();
    expect(result.current.data?.unit).toBe("tmai");

    rerender({ u: "other" });
    // Cleared synchronously on unit change so the old unit's pending flag
    // is never shown under the new unit's context.
    expect(result.current.data).toBeNull();
    await flush();
    expect(result.current.data?.unit).toBe("other");
    expect(result.current.data?.has_pending_delta).toBeUndefined();
  });

  it("keeps the last response visible across a poll (anti-flicker)", async () => {
    vi.mocked(api.producerFeed).mockResolvedValue(status("tmai", true));
    const { result } = renderHook(() => useProducerFeed("tmai"));
    await flush();
    expect(result.current.data?.has_pending_delta).toBe(true);

    // The hook handed exactly one poll callback to `setInterval`; fire it
    // by hand (no real 60s wait, no real timer) to exercise the re-poll.
    expect(pollCallbacks).toHaveLength(1);
    await act(async () => {
      pollCallbacks[0]?.();
    });
    expect(api.producerFeed).toHaveBeenCalledTimes(2);
    // Last response stays visible — never cleared on a poll.
    expect(result.current.data?.has_pending_delta).toBe(true);
  });
});
