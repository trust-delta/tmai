// @vitest-environment jsdom
//
// useAutoScrollPerAgent — per-agent persisted auto-scroll preference.
//
// S6 (#803) rebased the hook from per-instance `useState` (synced from the
// module Map only on `agentId` change) onto `useSyncExternalStore`, because
// the aim-console mounts TWO live consumers for the same agent at once: the
// status strip's `follow` toggle and the chromeless TerminalPanel's internal
// auto-scroll. These tests pin the original contract (default true, persists
// across remounts, per-agent isolation, updater-function setter) AND the new
// one (a set in one mounted instance reaches the other live).

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useAutoScrollPerAgent } from "../useAutoScrollPerAgent";

// Module-level store persists across tests — every test uses its own
// agent id so they stay independent.

describe("useAutoScrollPerAgent", () => {
  it("defaults to true for an unseen agent", () => {
    const { result } = renderHook(() => useAutoScrollPerAgent("as:default"));
    expect(result.current[0]).toBe(true);
  });

  it("persists the chosen value across unmount/remount", () => {
    const first = renderHook(() => useAutoScrollPerAgent("as:persist"));
    act(() => first.result.current[1](false));
    expect(first.result.current[0]).toBe(false);
    first.unmount();

    const second = renderHook(() => useAutoScrollPerAgent("as:persist"));
    expect(second.result.current[0]).toBe(false);
  });

  it("supports the useState-style updater function", () => {
    const { result } = renderHook(() => useAutoScrollPerAgent("as:updater"));
    act(() => result.current[1]((prev) => !prev));
    expect(result.current[0]).toBe(false);
    act(() => result.current[1]((prev) => !prev));
    expect(result.current[0]).toBe(true);
  });

  it("isolates agents from each other", () => {
    const a = renderHook(() => useAutoScrollPerAgent("as:iso-a"));
    const b = renderHook(() => useAutoScrollPerAgent("as:iso-b"));
    act(() => a.result.current[1](false));
    expect(a.result.current[0]).toBe(false);
    expect(b.result.current[0]).toBe(true);
  });

  it("syncs SIMULTANEOUSLY mounted consumers of the same agent live (#803)", () => {
    const strip = renderHook(() => useAutoScrollPerAgent("as:live"));
    const panel = renderHook(() => useAutoScrollPerAgent("as:live"));
    act(() => strip.result.current[1](false));
    // The other mounted instance picks the toggle up WITHOUT a remount —
    // this is what lets the aim-console strip drive the chromeless
    // TerminalPanel's internal auto-scroll.
    expect(panel.result.current[0]).toBe(false);
    act(() => panel.result.current[1](true));
    expect(strip.result.current[0]).toBe(true);
  });

  it("re-reads the store when the same instance swaps agents", () => {
    const seed = renderHook(() => useAutoScrollPerAgent("as:swap-target"));
    act(() => seed.result.current[1](false));

    const { result, rerender } = renderHook(({ id }) => useAutoScrollPerAgent(id), {
      initialProps: { id: "as:swap-origin" },
    });
    expect(result.current[0]).toBe(true);
    rerender({ id: "as:swap-target" });
    expect(result.current[0]).toBe(false);
  });
});
