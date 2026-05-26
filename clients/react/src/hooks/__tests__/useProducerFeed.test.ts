// @vitest-environment jsdom
//
// useProducerFeed — the producer-feed status poller behind the Producer
// console's "Check deltas ▸" button. We mock `api.producerFeed` so each
// test drives a deterministic response and asserts the sibling-shaped
// contract (mirrors useUnitPrs.test): `unit = null` parks (no fetch),
// the initial fetch flips `loading`, errors surface without fabricating
// data, a unit change re-fetches, and the 60s poll keeps the last
// response visible (anti-flicker).
//
// Timers stay real and the poll is exercised by capturing the
// `window.setInterval` callback directly — `@testing-library`'s
// `waitFor` cannot make progress under fake timers, and a real 60s wait
// is not viable in a unit test.

import { act, renderHook, waitFor } from "@testing-library/react";
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

describe("useProducerFeed", () => {
  beforeEach(() => {
    vi.mocked(api.producerFeed).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parks on unit=null — no fetch, not loading", () => {
    const { result } = renderHook(() => useProducerFeed(null));
    expect(api.producerFeed).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("fetches on a real unit and exposes the response", async () => {
    vi.mocked(api.producerFeed).mockResolvedValue(status("tmai", true));
    const { result } = renderHook(() => useProducerFeed("tmai"));
    expect(result.current.loading).toBe(true);
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(api.producerFeed).toHaveBeenCalledWith("tmai");
    expect(result.current.data?.has_pending_delta).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("surfaces a fetch error without fabricating data", async () => {
    vi.mocked(api.producerFeed).mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useProducerFeed("tmai"));
    await waitFor(() => {
      expect(result.current.error?.message).toBe("boom");
    });
    expect(result.current.data).toBeNull();
  });

  it("re-fetches when the unit changes and clears the previous status", async () => {
    vi.mocked(api.producerFeed).mockImplementation((u: string) =>
      Promise.resolve(status(u, u === "tmai")),
    );
    const { result, rerender } = renderHook(({ u }) => useProducerFeed(u), {
      initialProps: { u: "tmai" },
    });
    await waitFor(() => expect(result.current.data?.unit).toBe("tmai"));

    rerender({ u: "other" });
    // Cleared synchronously on unit change so the old unit's pending flag
    // is never shown under the new unit's context.
    expect(result.current.data).toBeNull();
    await waitFor(() => expect(result.current.data?.unit).toBe("other"));
    expect(result.current.data?.has_pending_delta).toBeUndefined();
  });

  it("keeps the last response visible across the 60s poll", async () => {
    // Spy only — `vi.spyOn` calls through, so `waitFor`'s own internal
    // `setInterval` polling still works. We read the captured callback
    // and fire it by hand instead of waiting a real 60s.
    const setIntervalSpy = vi.spyOn(window, "setInterval");

    vi.mocked(api.producerFeed).mockResolvedValue(status("tmai", true));
    const { result } = renderHook(() => useProducerFeed("tmai"));
    await waitFor(() => expect(result.current.data?.has_pending_delta).toBe(true));

    const tick = setIntervalSpy.mock.calls[0]?.[0] as (() => void) | undefined;
    expect(typeof tick).toBe("function");

    await act(async () => {
      tick?.();
    });
    await waitFor(() => expect(api.producerFeed).toHaveBeenCalledTimes(2));
    // Last response stays visible (anti-flicker) — never cleared on a poll.
    expect(result.current.data?.has_pending_delta).toBe(true);
  });
});
