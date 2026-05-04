// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      getNotificationSettings: vi.fn(),
    },
  };
});

const { api } = await import("@/lib/api");
const { useNotificationConfig } = await import("../useNotificationConfig");

describe("useNotificationConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // jsdom retains listeners across tests; explicit unmount handles that.
  });

  it("starts with the default config and refetches on mount", async () => {
    vi.mocked(api.getNotificationSettings).mockResolvedValue({
      notify_on_idle: false,
      notify_idle_threshold_secs: 42,
    });

    const { result } = renderHook(() => useNotificationConfig());

    // Initial render returns the default while the fetch is in flight.
    expect(result.current).toEqual({ enabled: true, thresholdSecs: 10 });

    await waitFor(() => {
      expect(result.current).toEqual({ enabled: false, thresholdSecs: 42 });
    });
    expect(vi.mocked(api.getNotificationSettings)).toHaveBeenCalledTimes(1);
  });

  it("refetches on window focus to pick up Settings changes", async () => {
    // First fetch returns enabled; second (after focus) returns disabled.
    vi.mocked(api.getNotificationSettings)
      .mockResolvedValueOnce({ notify_on_idle: true, notify_idle_threshold_secs: 10 })
      .mockResolvedValueOnce({ notify_on_idle: false, notify_idle_threshold_secs: 10 });

    const { result } = renderHook(() => useNotificationConfig());

    await waitFor(() => {
      expect(result.current.enabled).toBe(true);
    });

    // Simulate the user toggling notify_on_idle off in another Settings tab,
    // then bringing this tab back into focus.
    await act(async () => {
      window.dispatchEvent(new FocusEvent("focus"));
    });

    await waitFor(() => {
      expect(result.current.enabled).toBe(false);
    });
    expect(vi.mocked(api.getNotificationSettings)).toHaveBeenCalledTimes(2);
  });

  it("refetches on visibility change when the tab becomes visible", async () => {
    vi.mocked(api.getNotificationSettings)
      .mockResolvedValueOnce({ notify_on_idle: true, notify_idle_threshold_secs: 10 })
      .mockResolvedValueOnce({ notify_on_idle: true, notify_idle_threshold_secs: 60 });

    const { result } = renderHook(() => useNotificationConfig());

    await waitFor(() => {
      expect(result.current.thresholdSecs).toBe(10);
    });

    // jsdom defaults visibilityState to "visible"; the hook's listener
    // re-fetches when that state is "visible". Firing the event without
    // changing the property still triggers the refresh path under our
    // implementation, which mirrors how a tab focusing back from the
    // background behaves in real browsers.
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() => {
      expect(result.current.thresholdSecs).toBe(60);
    });
  });

  it("ignores fetch errors and keeps the last good config", async () => {
    vi.mocked(api.getNotificationSettings)
      .mockResolvedValueOnce({ notify_on_idle: true, notify_idle_threshold_secs: 30 })
      .mockRejectedValueOnce(new Error("server down"));

    const { result } = renderHook(() => useNotificationConfig());
    await waitFor(() => {
      expect(result.current.thresholdSecs).toBe(30);
    });

    await act(async () => {
      window.dispatchEvent(new FocusEvent("focus"));
    });

    // Wait long enough for the rejected promise to settle, then assert no
    // change. The hook swallows fetch errors silently.
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current).toEqual({ enabled: true, thresholdSecs: 30 });
  });
});
