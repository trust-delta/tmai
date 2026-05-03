import { useCallback, useEffect, useRef, useState } from "react";
import type { AutoSaveStatus } from "./useAutoSave";

export interface UseSaveTrackerResult {
  status: AutoSaveStatus;
  error: string | null;
  /**
   * Wraps a save operation with status transitions
   * (saving → saved → idle, or → error). The optional `onError` runs after
   * the catch — use it to roll back optimistic local state for atomic
   * fields. Text fields should leave their draft alone.
   */
  track: (op: () => Promise<unknown>, opts?: { onError?: () => void }) => Promise<void>;
  /** Manually clear the error state (e.g., when the user edits a draft after a failed commit). */
  clearError: () => void;
}

/**
 * Lightweight section-level save status helper used by the Settings panel
 * auto-save (#578). Compared to {@link useAutoSave} this hook does not
 * manage the field value itself — it only wraps an existing PUT call so the
 * existing setState-then-API pattern can keep working with minimal churn.
 */
export function useSaveTracker(savedFadeMs = 1000): UseSaveTrackerResult {
  const [status, setStatus] = useState<AutoSaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const fadeRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Token guards against stale completions when multiple saves overlap.
  const tokenRef = useRef(0);

  useEffect(
    () => () => {
      if (fadeRef.current !== null) clearTimeout(fadeRef.current);
    },
    [],
  );

  const track = useCallback(
    async (op: () => Promise<unknown>, opts?: { onError?: () => void }) => {
      const token = ++tokenRef.current;
      if (fadeRef.current !== null) clearTimeout(fadeRef.current);
      setStatus("saving");
      setError(null);
      try {
        await op();
        if (token !== tokenRef.current) return;
        setStatus("saved");
        fadeRef.current = setTimeout(() => {
          fadeRef.current = null;
          setStatus((s) => (s === "saved" ? "idle" : s));
        }, savedFadeMs);
      } catch (e) {
        if (token !== tokenRef.current) return;
        opts?.onError?.();
        setStatus("error");
        setError(e instanceof Error ? e.message : "Save failed");
      }
    },
    [savedFadeMs],
  );

  const clearError = useCallback(() => {
    setStatus((s) => (s === "error" ? "idle" : s));
    setError(null);
  }, []);

  return { status, error, track, clearError };
}
