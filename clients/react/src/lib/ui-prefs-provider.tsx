import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  DEFAULT_UI_PREFS,
  loadUIPrefs,
  saveUIPrefs,
  UI_PREFS_STORAGE_KEY,
  type UIPrefs,
} from "./ui-prefs";

interface UIPrefsContextValue {
  prefs: UIPrefs;
  setPref: <K extends keyof UIPrefs>(key: K, value: UIPrefs[K]) => void;
  resetPrefs: () => void;
}

const UIPrefsContext = createContext<UIPrefsContextValue | null>(null);

export function UIPrefsProvider({ children }: { children: ReactNode }) {
  // Lazy-init from localStorage so the first render already has the
  // persisted layout — avoids a flash of the default mode on reload.
  const [prefs, setPrefs] = useState<UIPrefs>(() => loadUIPrefs());

  // Persist on every change. saveUIPrefs swallows quota / private-mode
  // errors so a failed write never breaks the in-memory state.
  useEffect(() => {
    saveUIPrefs(prefs);
  }, [prefs]);

  // Cross-tab sync: when another tab updates the consolidated blob,
  // mirror it here so both views agree on layout / toggles.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== UI_PREFS_STORAGE_KEY) return;
      setPrefs(loadUIPrefs());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setPref = useCallback(<K extends keyof UIPrefs>(key: K, value: UIPrefs[K]) => {
    setPrefs((prev) => (prev[key] === value ? prev : { ...prev, [key]: value }));
  }, []);

  const resetPrefs = useCallback(() => {
    setPrefs({ ...DEFAULT_UI_PREFS });
  }, []);

  const value = useMemo(() => ({ prefs, setPref, resetPrefs }), [prefs, setPref, resetPrefs]);

  return <UIPrefsContext.Provider value={value}>{children}</UIPrefsContext.Provider>;
}

export function useUIPrefs(): UIPrefsContextValue {
  const ctx = useContext(UIPrefsContext);
  if (!ctx) throw new Error("useUIPrefs must be used inside <UIPrefsProvider>");
  return ctx;
}

// Non-throwing variant. `useActiveTheme` lives deep in the terminal hook,
// which a few unit tests render outside any provider (xterm wiring tests);
// they should fall back to persisted/default prefs rather than crash.
export function useUIPrefsOptional(): UIPrefsContextValue | null {
  return useContext(UIPrefsContext);
}

// Convenience selector for a single field. Returns `[value, setter]` —
// shaped like useState so call sites read naturally.
export function useUIPref<K extends keyof UIPrefs>(
  key: K,
): [UIPrefs[K], (value: UIPrefs[K]) => void] {
  const { prefs, setPref } = useUIPrefs();
  const setter = useCallback((value: UIPrefs[K]) => setPref(key, value), [key, setPref]);
  return [prefs[key], setter];
}
