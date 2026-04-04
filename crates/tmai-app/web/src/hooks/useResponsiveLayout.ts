import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY_SIDEBAR = "tmai:sidebar-collapsed";
const STORAGE_KEY_ACTION_PANEL = "tmai:action-panel-collapsed";
const NARROW_BREAKPOINT = "(min-width: 1024px)";

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

export interface UseResponsiveLayoutResult {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  actionPanelCollapsed: boolean;
  toggleActionPanel: () => void;
  isNarrowScreen: boolean;
}

// Manage responsive layout state: sidebar collapse, action panel collapse, narrow screen detection
export function useResponsiveLayout(): UseResponsiveLayoutResult {
  const [isNarrowScreen, setIsNarrowScreen] = useState(() => {
    if (typeof window === "undefined") return false;
    return !window.matchMedia(NARROW_BREAKPOINT).matches;
  });

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window !== "undefined" && !window.matchMedia(NARROW_BREAKPOINT).matches) {
      return true; // Auto-collapse on narrow screens
    }
    return readStoredBool(STORAGE_KEY_SIDEBAR, false);
  });

  const [actionPanelCollapsed, setActionPanelCollapsed] = useState(() => {
    if (typeof window !== "undefined" && !window.matchMedia(NARROW_BREAKPOINT).matches) {
      return true; // Auto-collapse on narrow screens
    }
    return readStoredBool(STORAGE_KEY_ACTION_PANEL, false);
  });

  // Track narrow screen via matchMedia
  useEffect(() => {
    const mql = window.matchMedia(NARROW_BREAKPOINT);
    const handler = (e: MediaQueryListEvent) => {
      const narrow = !e.matches;
      setIsNarrowScreen(narrow);
      if (narrow) {
        // Auto-collapse both panels on narrow screens
        setSidebarCollapsed(true);
        setActionPanelCollapsed(true);
      }
    };
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  // Toggle sidebar with localStorage persistence
  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY_SIDEBAR, String(next));
      } catch {
        // ignore
      }
      // Notify xterm.js and other resize-aware components
      requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
      return next;
    });
  }, []);

  // Toggle action panel with localStorage persistence
  const toggleActionPanel = useCallback(() => {
    setActionPanelCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY_ACTION_PANEL, String(next));
      } catch {
        // ignore
      }
      requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
      return next;
    });
  }, []);

  return {
    sidebarCollapsed,
    toggleSidebar,
    actionPanelCollapsed,
    toggleActionPanel,
    isNarrowScreen,
  };
}
