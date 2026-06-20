// @vitest-environment jsdom
//
// The resize-notify rAF lifecycle. A sidebar / action-panel toggle schedules a
// `window.dispatchEvent(new Event("resize"))` one frame later. The regression
// these tests pin (#852 fallout): that deferred callback was never cancelled,
// so when a test unmounted (or the jsdom env was torn down) before the frame
// fired, it ran against a gone `window` and threw `ReferenceError: window is
// not defined` — an unhandled error Vitest attributes to whichever test is
// mid-flight (Gutters / RPanel in CI), failing the whole run.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useResponsiveLayout } from "../useResponsiveLayout";

// jsdom doesn't ship matchMedia; the hook reads it on mount to seed the
// narrow/mobile flags. A minimal always-matching stub is sufficient — we don't
// exercise the breakpoint flags here.
beforeAll(() => {
  if (!window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: true,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
        onchange: null,
      })),
    });
  }
});

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useResponsiveLayout resize-notify rAF lifecycle", () => {
  it("cancels a still-pending resize-notify rAF on unmount", () => {
    // Capture the scheduled frame callback instead of running it, so we can
    // assert what happens to a notification that is still in flight at unmount.
    let nextId = 1;
    const rafSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((_cb: FrameRequestCallback) => nextId++);
    const cancelSpy = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});

    const { result, unmount } = renderHook(() => useResponsiveLayout());

    // A toggle schedules exactly one one-frame-later resize notification.
    act(() => result.current.toggleSidebar());
    expect(rafSpy).toHaveBeenCalledTimes(1);

    // Unmount before the frame fires: the pending rAF (id 1) must be cancelled
    // so it can never run against a torn-down window. This is the fix — pre-fix
    // the id was untracked and the callback fired post-teardown.
    unmount();
    expect(cancelSpy).toHaveBeenCalledWith(1);
  });

  it("dispatches a single resize when the scheduled frame fires while mounted", () => {
    let scheduled: FrameRequestCallback | null = null;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) => {
      scheduled = cb;
      return 1;
    });
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");

    const { result } = renderHook(() => useResponsiveLayout());
    act(() => result.current.toggleActionPanel());
    expect(scheduled).not.toBeNull();

    // Fire the captured frame: a single `resize` reaches resize-aware listeners.
    act(() => (scheduled as FrameRequestCallback)(0));
    const resizeDispatched = dispatchSpy.mock.calls.some(
      ([e]) => e instanceof Event && e.type === "resize",
    );
    expect(resizeDispatched).toBe(true);
  });

  it("re-arming the toggle cancels the prior pending frame (no double resize)", () => {
    // Two rapid toggles must coalesce to one pending frame — the second cancels
    // the first so resize-aware components are nudged once, not twice.
    let nextId = 1;
    const cancelSpy = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(
      (_cb: FrameRequestCallback) => nextId++,
    );

    const { result } = renderHook(() => useResponsiveLayout());
    act(() => result.current.toggleSidebar());
    act(() => result.current.toggleSidebar());

    // The second schedule cancelled the first (id 1).
    expect(cancelSpy).toHaveBeenCalledWith(1);
  });
});
