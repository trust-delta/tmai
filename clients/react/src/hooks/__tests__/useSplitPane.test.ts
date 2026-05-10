// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { makeSplitKeyHandler, RATIO_STEP, useSplitPane } from "../useSplitPane";

// jsdom doesn't ship matchMedia. useSplitPane reads it once on mount to seed
// the narrow-screen flag — we don't exercise that flag here, so a minimal
// always-matching stub is sufficient.
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

describe("useSplitPane.adjustRatio", () => {
  it("nudges the ratio by a finite delta and notifies onCommit", () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() => useSplitPane({ initialRatio: 0.5, onCommit }));

    act(() => result.current.adjustRatio(0.1));
    expect(result.current.splitRatio).toBeCloseTo(0.6, 5);
    expect(onCommit).toHaveBeenLastCalledWith(expect.closeTo(0.6, 5));

    act(() => result.current.adjustRatio(-0.05));
    expect(result.current.splitRatio).toBeCloseTo(0.55, 5);
  });

  it("clamps to the legal window (0.2..0.8)", () => {
    const { result } = renderHook(() => useSplitPane({ initialRatio: 0.5 }));

    act(() => result.current.adjustRatio(10));
    expect(result.current.splitRatio).toBe(0.8);

    act(() => result.current.adjustRatio(-10));
    expect(result.current.splitRatio).toBe(0.2);
  });

  it("snaps to min/max with ±Infinity", () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() => useSplitPane({ initialRatio: 0.5, onCommit }));

    act(() => result.current.adjustRatio(Number.POSITIVE_INFINITY));
    expect(result.current.splitRatio).toBe(0.8);
    expect(onCommit).toHaveBeenLastCalledWith(0.8);

    act(() => result.current.adjustRatio(Number.NEGATIVE_INFINITY));
    expect(result.current.splitRatio).toBe(0.2);
    expect(onCommit).toHaveBeenLastCalledWith(0.2);
  });

  it("does not call onCommit when the ratio doesn't change (already at max)", () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() => useSplitPane({ initialRatio: 0.8, onCommit }));

    act(() => result.current.adjustRatio(Number.POSITIVE_INFINITY));
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("preserves the current ratio when delta makes the result NaN (CodeRabbit PR #640)", () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() => useSplitPane({ initialRatio: 0.5, onCommit }));

    // `0.5 + NaN` is NaN; the centralised clampRatio must return the
    // previous valid ratio rather than letting NaN poison local state.
    act(() => result.current.adjustRatio(Number.NaN));
    expect(result.current.splitRatio).toBe(0.5);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("clamps a non-finite initialRatio at mount", () => {
    const { result } = renderHook(() => useSplitPane({ initialRatio: Number.NaN }));
    // Default fallback (0.5) wins over NaN seed.
    expect(result.current.splitRatio).toBe(0.5);
  });
});

describe("makeSplitKeyHandler", () => {
  function makeEvent(key: string): React.KeyboardEvent {
    return { key, preventDefault: vi.fn() } as unknown as React.KeyboardEvent;
  }

  it("maps Left/Right to ±step on horizontal", () => {
    const adjust = vi.fn();
    const handler = makeSplitKeyHandler("horizontal", RATIO_STEP, adjust);

    handler(makeEvent("ArrowLeft"));
    expect(adjust).toHaveBeenLastCalledWith(-RATIO_STEP);

    handler(makeEvent("ArrowRight"));
    expect(adjust).toHaveBeenLastCalledWith(RATIO_STEP);
  });

  it("maps Up/Down to ±step on vertical", () => {
    const adjust = vi.fn();
    const handler = makeSplitKeyHandler("vertical", RATIO_STEP, adjust);

    handler(makeEvent("ArrowUp"));
    expect(adjust).toHaveBeenLastCalledWith(-RATIO_STEP);

    handler(makeEvent("ArrowDown"));
    expect(adjust).toHaveBeenLastCalledWith(RATIO_STEP);
  });

  it("maps Home/End to ±Infinity on both axes", () => {
    const adjust = vi.fn();
    const handler = makeSplitKeyHandler("horizontal", RATIO_STEP, adjust);

    handler(makeEvent("Home"));
    expect(adjust).toHaveBeenLastCalledWith(Number.NEGATIVE_INFINITY);

    handler(makeEvent("End"));
    expect(adjust).toHaveBeenLastCalledWith(Number.POSITIVE_INFINITY);
  });

  it("ignores unrelated keys without preventing default", () => {
    const adjust = vi.fn();
    const handler = makeSplitKeyHandler("horizontal", RATIO_STEP, adjust);
    const evt = makeEvent("Tab");

    handler(evt);
    expect(adjust).not.toHaveBeenCalled();
    expect(evt.preventDefault).not.toHaveBeenCalled();
  });

  it("on horizontal, vertical-axis arrows are inert (no double-binding)", () => {
    const adjust = vi.fn();
    const handler = makeSplitKeyHandler("horizontal", RATIO_STEP, adjust);

    handler(makeEvent("ArrowUp"));
    handler(makeEvent("ArrowDown"));
    expect(adjust).not.toHaveBeenCalled();
  });
});
