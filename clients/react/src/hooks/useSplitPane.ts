import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_RATIO = 0.5;
const MIN_RATIO = 0.2;
const MAX_RATIO = 0.8;
const NARROW_BREAKPOINT = "(min-width: 1024px)";

/** Step (fraction of total span) applied per arrow-key press on a split divider. */
export const RATIO_STEP = 0.025;

export type SplitOrientation = "horizontal" | "vertical";

// Build a keydown handler implementing the WAI-ARIA Window Splitter
// pattern: arrow keys nudge the ratio by `step`, Home/End jump to
// min/max. Both axes use the visual mapping (Left/Up = decrement,
// Right/Down = increment).
export function makeSplitKeyHandler(
  orientation: SplitOrientation,
  step: number,
  adjust: (delta: number) => void,
) {
  return (e: React.KeyboardEvent) => {
    const isHorizontal = orientation === "horizontal";
    const decKey = isHorizontal ? "ArrowLeft" : "ArrowUp";
    const incKey = isHorizontal ? "ArrowRight" : "ArrowDown";
    if (e.key === decKey) {
      e.preventDefault();
      adjust(-step);
    } else if (e.key === incKey) {
      e.preventDefault();
      adjust(step);
    } else if (e.key === "Home") {
      e.preventDefault();
      adjust(Number.NEGATIVE_INFINITY);
    } else if (e.key === "End") {
      e.preventDefault();
      adjust(Number.POSITIVE_INFINITY);
    }
  };
}

interface UseSplitPaneOptions {
  /** Orientation of the split. `horizontal` = left/right; `vertical` = top/bottom. */
  orientation?: SplitOrientation;
  /** Initial ratio (0–1). When this changes, the in-memory ratio is reseeded. */
  initialRatio?: number;
  /** Called once on mouseup with the final ratio — wire this to your prefs store. */
  onCommit?: (ratio: number) => void;
}

export interface UseSplitPaneResult {
  splitRatio: number;
  isDragging: boolean;
  isNarrowScreen: boolean;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onDividerMouseDown: (e: React.MouseEvent) => void;
  onDividerDoubleClick: () => void;
  /** Programmatic ratio adjustment. `+/-Infinity` snap to max / min, finite
   *  values add to the current ratio (clamped). Wired to keyboard arrows so
   *  divider drag works for keyboard-only users too. */
  adjustRatio: (delta: number) => void;
}

// Manage split-pane drag state for either horizontal or vertical layouts.
// Persistence is intentionally NOT handled here — the caller owns the
// initialRatio (typically read from the UI prefs store) and receives the
// final ratio via onCommit on mouseup. This keeps the hook in-memory only,
// avoids per-frame writes during drag, and lets a single prefs store
// coordinate all persisted layout values.
export function useSplitPane({
  orientation = "horizontal",
  initialRatio = DEFAULT_RATIO,
  onCommit,
}: UseSplitPaneOptions = {}): UseSplitPaneResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [splitRatio, setSplitRatio] = useState(() =>
    Math.max(MIN_RATIO, Math.min(MAX_RATIO, initialRatio)),
  );
  const [isDragging, setIsDragging] = useState(false);
  const [isNarrowScreen, setIsNarrowScreen] = useState(() => {
    if (typeof window === "undefined") return false;
    return !window.matchMedia(NARROW_BREAKPOINT).matches;
  });

  // When the persisted initialRatio changes (other tab edited it, prefs
  // reset, etc.) reseed local state so the divider tracks the source of
  // truth. We skip the update mid-drag so the user's interaction wins.
  useEffect(() => {
    if (isDragging) return;
    setSplitRatio(Math.max(MIN_RATIO, Math.min(MAX_RATIO, initialRatio)));
  }, [initialRatio, isDragging]);

  // Track narrow screen via matchMedia
  useEffect(() => {
    const mql = window.matchMedia(NARROW_BREAKPOINT);
    const handler = (e: MediaQueryListEvent) => setIsNarrowScreen(!e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  const onDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  const onDividerDoubleClick = useCallback(() => {
    setSplitRatio(DEFAULT_RATIO);
    onCommitRef.current?.(DEFAULT_RATIO);
  }, []);

  const adjustRatio = useCallback((delta: number) => {
    setSplitRatio((prev) => {
      const target =
        delta === Number.POSITIVE_INFINITY
          ? MAX_RATIO
          : delta === Number.NEGATIVE_INFINITY
            ? MIN_RATIO
            : prev + delta;
      const next = Math.max(MIN_RATIO, Math.min(MAX_RATIO, target));
      if (next !== prev) onCommitRef.current?.(next);
      return next;
    });
  }, []);

  const splitRatioRef = useRef(splitRatio);
  splitRatioRef.current = splitRatio;

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const ratio =
        orientation === "horizontal"
          ? (e.clientX - rect.left) / rect.width
          : (e.clientY - rect.top) / rect.height;
      setSplitRatio(Math.max(MIN_RATIO, Math.min(MAX_RATIO, ratio)));
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      onCommitRef.current?.(splitRatioRef.current);
      // Notify xterm.js and other ResizeObserver-based components
      window.dispatchEvent(new Event("resize"));
    };

    const cursor = orientation === "horizontal" ? "col-resize" : "row-resize";
    document.body.style.cursor = cursor;
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, orientation]);

  return {
    splitRatio,
    isDragging,
    isNarrowScreen,
    containerRef,
    onDividerMouseDown,
    onDividerDoubleClick,
    adjustRatio,
  };
}
