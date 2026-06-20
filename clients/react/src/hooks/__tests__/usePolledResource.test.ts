// @vitest-environment jsdom
//
// The shared R-panel resource hook. The regression these tests pin: an
// in-flight fetch that resolves after the consumer unmounts (or after the
// depKey moves on) must be DROPPED, never stamped via setState. A
// post-unmount setState is what made the whole Vitest suite fail
// nondeterministically — React 19's resolveUpdatePriority reads `window`
// during the update, and the jsdom teardown has already removed it
// (`ReferenceError: window is not defined`). A single test can't reproduce
// that crash (window is present during the test), so the generation guard is
// proven via the observable depKey-change path; the deterministic full-suite
// green run is the teardown proof.
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePolledResource } from "../usePolledResource";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("usePolledResource", () => {
  it("fetches once and stamps data/loading on a non-null depKey", async () => {
    const fetcher = vi.fn(() => Promise.resolve("hello"));
    const { result } = renderHook(() => usePolledResource("u", fetcher));
    expect(result.current.loading).toBe(true);
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.current.data).toBe("hello");
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("parks on a null depKey (no fetch, not loading)", () => {
    const fetcher = vi.fn(() => Promise.resolve("z"));
    const { result } = renderHook(() => usePolledResource(null, fetcher));
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeNull();
  });

  it("drops a response from a previous depKey (generation guard)", async () => {
    const dA = deferred<string>();
    const dB = deferred<string>();
    const queue = [dA, dB];
    let i = 0;
    const fetcher = vi.fn(() => queue[i++].promise);

    const { result, rerender } = renderHook(
      ({ k }: { k: string }) => usePolledResource(k, fetcher),
      { initialProps: { k: "a" } },
    );
    // Switch selection before "a" resolves — the effect re-runs and fires the
    // second fetch (dB) under a new generation.
    rerender({ k: "b" });
    expect(fetcher).toHaveBeenCalledTimes(2);

    // The fresh (b) response stamps.
    await act(async () => {
      dB.resolve("B");
      await Promise.resolve();
    });
    expect(result.current.data).toBe("B");

    // The stale (a) response resolves last and must be dropped.
    await act(async () => {
      dA.resolve("A-stale");
      await Promise.resolve();
    });
    expect(result.current.data).toBe("B");
  });

  it("drops an in-flight response that resolves after unmount (no throw)", async () => {
    const d = deferred<string>();
    const fetcher = vi.fn(() => d.promise);
    const { result, unmount } = renderHook(() => usePolledResource("u", fetcher));
    unmount();
    // The cleanup bumped the generation, so resolving now is a dropped no-op
    // rather than a setState on a gone component.
    await act(async () => {
      d.resolve("late");
      await d.promise;
    });
    expect(result.current.data).toBeNull();
  });

  it("polls every intervalMs and stops polling on unmount", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(() => Promise.resolve("x"));
    const { unmount } = renderHook(() => usePolledResource("u", fetcher, { intervalMs: 1000 }));
    expect(fetcher).toHaveBeenCalledTimes(1); // initial fetch
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(fetcher).toHaveBeenCalledTimes(2); // one poll tick
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(fetcher).toHaveBeenCalledTimes(2); // interval cleared on unmount
  });

  it("one-shot (no intervalMs) fetches once and never polls", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(() => Promise.resolve("y"));
    renderHook(() => usePolledResource("u", fetcher));
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("refresh re-fetches under the current generation; no-op while parked", async () => {
    const fetcher = vi.fn(() => Promise.resolve("a"));
    const { result, rerender } = renderHook(
      ({ k }: { k: string | null }) => usePolledResource(k, fetcher),
      { initialProps: { k: "u" as string | null } },
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetcher).toHaveBeenCalledTimes(1);

    await act(async () => {
      result.current.refresh();
      await Promise.resolve();
    });
    expect(fetcher).toHaveBeenCalledTimes(2);

    // Park, then refresh must be a no-op.
    rerender({ k: null });
    act(() => {
      result.current.refresh();
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
