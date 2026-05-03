// @vitest-environment jsdom
import { act, render, renderHook, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutoSave } from "../useAutoSave";

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useAutoSave — atomic flow (change)", () => {
  it("invokes save once and transitions idle → saving → saved → idle", async () => {
    vi.useFakeTimers();
    const save = vi.fn(async (_next: number) => {});
    const { result } = renderHook(() => useAutoSave<number>(0, save, { savedFadeMs: 50 }));

    expect(result.current.status).toBe("idle");
    expect(result.current.value).toBe(0);

    await act(async () => {
      result.current.change(1);
    });

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(1);
    expect(result.current.value).toBe(1);
    expect(result.current.status).toBe("saved");

    await act(async () => {
      vi.advanceTimersByTime(60);
    });
    expect(result.current.status).toBe("idle");
  });

  it("rolls back local state on error and surfaces the error message", async () => {
    const save = vi.fn(async (_next: string) => {
      throw new Error("API error 400: bad value");
    });
    const { result } = renderHook(() => useAutoSave<string>("a", save));

    await act(async () => {
      result.current.change("b");
    });

    expect(result.current.value).toBe("a");
    expect(result.current.status).toBe("error");
    expect(result.current.error).toMatch(/bad value/);
  });

  it("adopts a server-normalised value when save resolves with one", async () => {
    const save = vi.fn(async (next: string) => next.trim());
    const { result } = renderHook(() => useAutoSave<string>("hello", save));

    await act(async () => {
      result.current.change("  trimmed  ");
    });

    expect(result.current.value).toBe("trimmed");
  });
});

describe("useAutoSave — text flow (setDraft + commit)", () => {
  it("setDraft does not invoke save", () => {
    const save = vi.fn(async (_next: string) => {});
    const { result } = renderHook(() => useAutoSave<string>("", save));

    act(() => {
      result.current.setDraft("p");
    });
    act(() => {
      result.current.setDraft("pa");
    });
    act(() => {
      result.current.setDraft("pat");
    });

    expect(save).not.toHaveBeenCalled();
    expect(result.current.value).toBe("pat");
  });

  it("commit triggers a single save with the current draft value", async () => {
    const save = vi.fn(async (_next: string) => {});
    const { result } = renderHook(() => useAutoSave<string>("", save));

    act(() => {
      result.current.setDraft("hello");
    });

    await act(async () => {
      result.current.commit();
    });

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("hello");
  });

  it("when rollbackOnError=false, keeps draft on error so the user can correct", async () => {
    const save = vi.fn(async (_next: string) => {
      throw new Error("validation rejected");
    });
    const { result } = renderHook(() =>
      useAutoSave<string>("orig", save, { rollbackOnError: false }),
    );

    act(() => {
      result.current.setDraft("typed-but-invalid");
    });
    await act(async () => {
      result.current.commit();
    });

    expect(result.current.value).toBe("typed-but-invalid");
    expect(result.current.status).toBe("error");
    expect(result.current.error).toMatch(/validation rejected/);
  });

  it("setDraft after an error clears the error state", async () => {
    const save = vi.fn<(value: string) => Promise<void>>().mockRejectedValueOnce(new Error("nope"));
    const { result } = renderHook(() => useAutoSave<string>("a", save, { rollbackOnError: false }));

    act(() => {
      result.current.setDraft("bad");
    });
    await act(async () => {
      result.current.commit();
    });
    expect(result.current.status).toBe("error");

    act(() => {
      result.current.setDraft("good");
    });
    expect(result.current.status).toBe("idle");
    expect(result.current.error).toBeNull();
  });
});

describe("useAutoSave — concurrency", () => {
  it("drops stale save responses (newer save wins)", async () => {
    const resolvers: Array<() => void> = [];
    const save = vi.fn(
      (_next: number) =>
        new Promise<void>((resolve) => {
          resolvers.push(resolve);
        }),
    );

    const { result } = renderHook(() => useAutoSave<number>(0, save));

    // Fire two saves; second should win.
    act(() => {
      result.current.change(1);
    });
    act(() => {
      result.current.change(2);
    });

    expect(save).toHaveBeenCalledTimes(2);

    // Resolve the second one first (newer, wins).
    await act(async () => {
      resolvers[1]();
      // Then resolve the older one — its result should be ignored.
      resolvers[0]();
    });

    await waitFor(() => {
      expect(result.current.status).toBe("saved");
    });
    expect(result.current.value).toBe(2);
  });
});

describe("useAutoSave — reset baseline", () => {
  it("reset() updates the rollback baseline without firing a save", () => {
    const save = vi.fn(async (_next: number) => {});
    const { result } = renderHook(() => useAutoSave<number>(0, save));

    act(() => {
      result.current.reset(42);
    });

    expect(save).not.toHaveBeenCalled();
    expect(result.current.value).toBe(42);
    expect(result.current.status).toBe("idle");
  });
});

// Ensure the hook does not leak the saved-fade timeout when the consumer
// unmounts mid-save (no act() warning, no setState-after-unmount).
describe("useAutoSave — cleanup", () => {
  it("does not warn when unmounting after a successful save", async () => {
    vi.useFakeTimers();
    const save = vi.fn(async (_next: number) => {});

    function Probe() {
      const { change } = useAutoSave<number>(0, save, { savedFadeMs: 1000 });
      useEffect(() => {
        change(1);
      }, [change]);
      return null;
    }

    const { unmount } = render(<Probe />);
    await act(async () => {
      vi.advanceTimersByTime(0);
    });
    unmount();
    // If the timer leaked it would fire here and call setState on an unmounted
    // tree. clearFade in the unmount effect should have cancelled it.
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
  });
});
