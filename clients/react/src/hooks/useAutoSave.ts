import { useCallback, useEffect, useRef, useState } from "react";

export type AutoSaveStatus = "idle" | "saving" | "saved" | "error";

export interface UseAutoSaveOptions {
  /**
   * For atomic fields (toggles, dropdowns) we roll back local state on
   * backend rejection so the UI reflects the persisted value. For text
   * fields the user is actively editing, so we leave the input intact and
   * only surface the inline error — set this to false in that case.
   * Default: true.
   */
  rollbackOnError?: boolean;
  /** Milliseconds the "saved" tick stays visible before fading to idle. */
  savedFadeMs?: number;
}

export interface UseAutoSaveResult<T> {
  /** Current local value — render this in inputs. */
  value: T;
  /** Atomic update — sets local state and immediately persists. */
  change: (next: T) => void;
  /** Draft update — sets local state only (for text fields mid-typing). */
  setDraft: (next: T) => void;
  /** Persist current local state (for blur / Enter on text fields). */
  commit: () => void;
  /** Persist an explicit value (alternative to setDraft + commit). */
  commitWith: (next: T) => void;
  /** Reset local state to a new baseline without firing a save. */
  reset: (next: T) => void;
  status: AutoSaveStatus;
  /** Backend error message when status is "error", null otherwise. */
  error: string | null;
}

/**
 * Centralised auto-save behaviour for the Settings panel (issue #578).
 *
 * Hybrid strategy:
 *   - atomic fields (boolean toggles, dropdowns, radios) call `change()` —
 *     local state updates and a PUT fires immediately;
 *   - text fields call `setDraft()` while typing and `commit()` on blur or
 *     Enter so the user does not see flickering validation errors mid-typing.
 *
 * On error the hook rolls back to the last known-saved value (atomic) or
 * leaves local state intact (text, via {@link UseAutoSaveOptions.rollbackOnError}
 * = false) so the user can correct the input. The save callback may return
 * a normalised value that the hook adopts as the new local + saved baseline.
 */
export function useAutoSave<T>(
  initial: T,
  save: (value: T) => Promise<T | undefined> | Promise<void>,
  options?: UseAutoSaveOptions,
): UseAutoSaveResult<T> {
  const { rollbackOnError = true, savedFadeMs = 1000 } = options ?? {};
  const [value, setValue] = useState<T>(initial);
  const [status, setStatus] = useState<AutoSaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const lastSavedRef = useRef<T>(initial);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Pending save token — stale completions are dropped so a slow PUT does not
  // overwrite a newer field state with its (now outdated) response.
  const pendingTokenRef = useRef(0);
  const saveRef = useRef(save);
  saveRef.current = save;

  const clearFade = useCallback(() => {
    if (fadeTimerRef.current !== null) {
      clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }
  }, []);

  useEffect(() => clearFade, [clearFade]);

  const performSave = useCallback(
    async (next: T) => {
      const previous = lastSavedRef.current;
      const token = ++pendingTokenRef.current;
      clearFade();
      setStatus("saving");
      setError(null);
      try {
        const returned = await saveRef.current(next);
        if (token !== pendingTokenRef.current) return; // newer save in-flight
        const persisted = (returned ?? next) as T;
        lastSavedRef.current = persisted;
        setValue(persisted);
        setStatus("saved");
        fadeTimerRef.current = setTimeout(() => {
          fadeTimerRef.current = null;
          setStatus((s) => (s === "saved" ? "idle" : s));
        }, savedFadeMs);
      } catch (e) {
        if (token !== pendingTokenRef.current) return;
        if (rollbackOnError) setValue(previous);
        setStatus("error");
        setError(e instanceof Error ? e.message : "Save failed");
      }
    },
    [clearFade, rollbackOnError, savedFadeMs],
  );

  const change = useCallback(
    (next: T) => {
      setValue(next);
      void performSave(next);
    },
    [performSave],
  );

  const setDraft = useCallback((next: T) => {
    setValue(next);
    setStatus((s) => (s === "error" ? "idle" : s));
    setError(null);
  }, []);

  const commit = useCallback(() => {
    void performSave(value);
  }, [performSave, value]);

  const commitWith = useCallback(
    (next: T) => {
      setValue(next);
      void performSave(next);
    },
    [performSave],
  );

  const reset = useCallback((next: T) => {
    pendingTokenRef.current++;
    lastSavedRef.current = next;
    setValue(next);
    setStatus("idle");
    setError(null);
  }, []);

  return { value, change, setDraft, commit, commitWith, reset, status, error };
}
