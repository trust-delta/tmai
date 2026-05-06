import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "tmai:dev-show-auto-discovered";

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

/**
 * Per-browser developer preference: when true, the sidebar agent list
 * surfaces Claude Code sessions tmai never spawned (`is_auto_discovered`).
 * Defaults to `false` — auto-discovered agents are hidden from the
 * regular operational view because they pollute it with the user's own
 * driving sessions (e.g. the CC running in tmux that fires hooks at
 * tmai-core's shared `/hooks/event` URL).
 *
 * Stored in localStorage rather than tmai-core settings because this is
 * a per-developer / per-browser dev affordance, not a workspace-wide
 * preference.
 */
export function useShowAutoDiscovered(): {
  show: boolean;
  toggle: () => void;
  set: (next: boolean) => void;
} {
  const [show, setShow] = useState(readStored);

  // Cross-tab sync: when the toggle is flipped in another tab/window
  // (or via DevTools), reflect it here without a manual reload.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setShow(readStored());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const set = useCallback((next: boolean) => {
    setShow(next);
    try {
      localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // localStorage may be unavailable (private browsing, quota); the
      // in-memory state still applies for the current tab.
    }
  }, []);

  const toggle = useCallback(() => set(!show), [show, set]);

  return { show, toggle, set };
}
