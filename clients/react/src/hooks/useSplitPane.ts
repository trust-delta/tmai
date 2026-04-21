import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY_RATIO = "tmai:split-ratio";
const STORAGE_KEY_ENABLED = "tmai:split-enabled";
const DEFAULT_RATIO = 0.5;
const MIN_RATIO = 0.2;
const MAX_RATIO = 0.8;
const NARROW_BREAKPOINT = "(min-width: 1024px)";

// Read a number from localStorage with a fallback default
function readStoredNumber(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

// Read a boolean from localStorage with a fallback default
function readStoredBool(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === "true";
  } catch {
    return fallback;
  }
}

export interface UseSplitPaneResult {
  splitRatio: number;
  splitEnabled: boolean;
  setSplitEnabled: (enabled: boolean) => void;
  isDragging: boolean;
  isNarrowScreen: boolean;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onDividerMouseDown: (e: React.MouseEvent) => void;
  onDividerDoubleClick: () => void;
}

// Manage split-pane layout state: drag ratio, enabled toggle, narrow-screen detection
export function useSplitPane(): UseSplitPaneResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [splitRatio, setSplitRatio] = useState(() => {
    const stored = readStoredNumber(STORAGE_KEY_RATIO, DEFAULT_RATIO);
    return Math.max(MIN_RATIO, Math.min(MAX_RATIO, stored));
  });
  const [splitEnabled, setSplitEnabledRaw] = useState(() =>
    readStoredBool(STORAGE_KEY_ENABLED, true),
  );
  const [isDragging, setIsDragging] = useState(false);
  const [isNarrowScreen, setIsNarrowScreen] = useState(() => {
    if (typeof window === "undefined") return false;
    return !window.matchMedia(NARROW_BREAKPOINT).matches;
  });

  // Persist splitEnabled to localStorage
  const setSplitEnabled = useCallback((enabled: boolean) => {
    setSplitEnabledRaw(enabled);
    try {
      localStorage.setItem(STORAGE_KEY_ENABLED, String(enabled));
    } catch {
      // ignore
    }
  }, []);

  // Track narrow screen via matchMedia
  useEffect(() => {
    const mql = window.matchMedia(NARROW_BREAKPOINT);
    const handler = (e: MediaQueryListEvent) => setIsNarrowScreen(!e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  // Divider mousedown handler
  const onDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  // Double-click divider to reset to 50/50
  const onDividerDoubleClick = useCallback(() => {
    setSplitRatio(DEFAULT_RATIO);
    try {
      localStorage.setItem(STORAGE_KEY_RATIO, String(DEFAULT_RATIO));
    } catch {
      // ignore
    }
  }, []);

  // Handle drag: mousemove + mouseup on document
  const splitRatioRef = useRef(splitRatio);
  splitRatioRef.current = splitRatio;

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      setSplitRatio(Math.max(MIN_RATIO, Math.min(MAX_RATIO, ratio)));
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      // Persist final ratio
      try {
        localStorage.setItem(STORAGE_KEY_RATIO, String(splitRatioRef.current));
      } catch {
        // ignore
      }
      // Notify xterm.js and other ResizeObserver-based components
      window.dispatchEvent(new Event("resize"));
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging]);

  return {
    splitRatio,
    splitEnabled,
    setSplitEnabled,
    isDragging,
    isNarrowScreen,
    containerRef,
    onDividerMouseDown,
    onDividerDoubleClick,
  };
}
