import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { api, type DirEntry } from "@/lib/api";
import { cn } from "@/lib/utils";

interface DirBrowserProps {
  /** Default confirm-and-close handler bound to "Select this" + entry
   *  double-click. Required for the picker mode (GeneralSection /
   *  ProducerSection); ignored when `actionSlot` is provided. */
  onSelect?: (path: string) => void;
  onCancel: () => void;
  /** Initial directory to load. When unset, the backend picks a default
   *  (typically the user's home). Phase 3 passes `default_project_root`
   *  here so users don't have to navigate from `~` every time. */
  startPath?: string | null;
  /** Replaces the single "Select this" button with caller-rendered actions
   *  for the currently-browsed path. NewAgentLauncher uses this to inline
   *  claude/codex/bash spawn buttons so the user picks a runtime in one
   *  click instead of "Select this" → secondary runtime menu. */
  actionSlot?: (currentPath: string) => ReactNode;
}

// Modal directory tree browser for selecting a project folder
export function DirBrowser({ onSelect, onCancel, startPath, actionSlot }: DirBrowserProps) {
  const [currentPath, setCurrentPath] = useState("");
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadDir = useCallback(async (path?: string) => {
    setLoading(true);
    setError("");
    try {
      const dirs = await api.listDirectories(path);
      setEntries(dirs);
      if (path) {
        setCurrentPath(path);
      } else if (dirs.length > 0) {
        const first = dirs[0].path;
        setCurrentPath(first.substring(0, first.lastIndexOf("/")));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDir(startPath ?? undefined);
  }, [loadDir, startPath]);

  const goUp = () => {
    if (!currentPath || currentPath === "/") return;
    const parent = currentPath.substring(0, currentPath.lastIndexOf("/")) || "/";
    loadDir(parent);
  };

  return (
    // Backdrop
    <div
      role="dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background"
      onClick={onCancel}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
    >
      {/* Modal */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: stops click propagation to close backdrop */}
      <div
        role="presentation"
        className="glass mx-4 flex w-full max-w-lg flex-col rounded-2xl border border-hairline-strong shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-hairline px-5 py-3">
          <h3 className="text-sm font-semibold text-foreground">Select Directory</h3>
          <button
            type="button"
            onClick={onCancel}
            className="rounded px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-surface-strong hover:text-foreground"
          >
            Cancel
          </button>
        </div>

        {/* Path bar */}
        <div className="flex items-center gap-2 border-b border-hairline px-5 py-2">
          <button
            type="button"
            onClick={goUp}
            disabled={!currentPath || currentPath === "/"}
            className="shrink-0 rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-surface-strong hover:text-foreground disabled:opacity-30"
          >
            ..
          </button>
          <span className="flex-1 truncate text-xs text-muted-foreground" title={currentPath}>
            {currentPath || "~"}
          </span>
          {!actionSlot && (
            <button
              type="button"
              onClick={() => onSelect?.(currentPath)}
              className="shrink-0 rounded-md bg-primary/20 px-3 py-1 text-xs text-primary transition-colors hover:bg-primary/30"
            >
              Select this
            </button>
          )}
        </div>

        {actionSlot && (
          <div className="border-b border-hairline px-5 py-2">{actionSlot(currentPath)}</div>
        )}

        {/* Directory listing */}
        <div className="max-h-80 overflow-y-auto">
          {loading && (
            <div className="px-5 py-6 text-center text-xs text-subtle-foreground">Loading...</div>
          )}
          {error && <div className="px-5 py-6 text-center text-xs text-destructive">{error}</div>}
          {!loading && !error && entries.length === 0 && (
            <div className="px-5 py-6 text-center text-xs text-subtle-foreground">
              No subdirectories
            </div>
          )}
          {!loading &&
            !error &&
            entries.map((entry) => (
              <button
                type="button"
                key={entry.path}
                onClick={() => loadDir(entry.path)}
                onDoubleClick={actionSlot ? undefined : () => onSelect?.(entry.path)}
                className={cn(
                  "flex w-full items-center gap-2 px-5 py-1.5 text-left text-xs transition-colors hover:bg-surface",
                  entry.is_git ? "text-primary" : "text-muted-foreground",
                )}
              >
                <span className="shrink-0 text-[10px]">{entry.is_git ? "●" : "▸"}</span>
                <span className="flex-1 truncate">{entry.name}</span>
                {entry.is_git && <span className="shrink-0 text-[9px] text-primary">git</span>}
              </button>
            ))}
        </div>

        {/* Footer hint */}
        <div className="border-t border-hairline px-5 py-2">
          <p className="text-[10px] text-subtle-foreground">
            {actionSlot
              ? "Click to navigate, then pick a runtime to spawn here"
              : "Click to navigate, double-click to select"}
          </p>
        </div>
      </div>
    </div>
  );
}
