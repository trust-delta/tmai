import { useCallback, useEffect, useState } from "react";
import { api, type DirEntry } from "@/lib/api";
import { cn } from "@/lib/utils";

interface DirBrowserProps {
  onSelect: (path: string) => void;
  onCancel: () => void;
}

// Modal directory tree browser for selecting a project folder
export function DirBrowser({ onSelect, onCancel }: DirBrowserProps) {
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
    loadDir();
  }, [loadDir]);

  const goUp = () => {
    if (!currentPath || currentPath === "/") return;
    const parent = currentPath.substring(0, currentPath.lastIndexOf("/")) || "/";
    loadDir(parent);
  };

  return (
    // Backdrop
    <div
      role="dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onCancel}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
    >
      {/* Modal */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: stops click propagation to close backdrop */}
      <div
        role="presentation"
        className="glass mx-4 flex w-full max-w-lg flex-col rounded-2xl border border-white/10 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/5 px-5 py-3">
          <h3 className="text-sm font-semibold text-zinc-200">Select Directory</h3>
          <button
            type="button"
            onClick={onCancel}
            className="rounded px-2 py-0.5 text-xs text-zinc-500 transition-colors hover:bg-white/10 hover:text-zinc-300"
          >
            Cancel
          </button>
        </div>

        {/* Path bar */}
        <div className="flex items-center gap-2 border-b border-white/5 px-5 py-2">
          <button
            type="button"
            onClick={goUp}
            disabled={!currentPath || currentPath === "/"}
            className="shrink-0 rounded px-1.5 py-0.5 text-xs text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-200 disabled:opacity-30"
          >
            ..
          </button>
          <span className="flex-1 truncate text-xs text-zinc-500" title={currentPath}>
            {currentPath || "~"}
          </span>
          <button
            type="button"
            onClick={() => onSelect(currentPath)}
            className="shrink-0 rounded-md bg-cyan-500/20 px-3 py-1 text-xs text-cyan-400 transition-colors hover:bg-cyan-500/30"
          >
            Select this
          </button>
        </div>

        {/* Directory listing */}
        <div className="max-h-80 overflow-y-auto">
          {loading && <div className="px-5 py-6 text-center text-xs text-zinc-600">Loading...</div>}
          {error && <div className="px-5 py-6 text-center text-xs text-red-400">{error}</div>}
          {!loading && !error && entries.length === 0 && (
            <div className="px-5 py-6 text-center text-xs text-zinc-600">No subdirectories</div>
          )}
          {!loading &&
            !error &&
            entries.map((entry) => (
              <button
                type="button"
                key={entry.path}
                onClick={() => loadDir(entry.path)}
                onDoubleClick={() => onSelect(entry.path)}
                className={cn(
                  "flex w-full items-center gap-2 px-5 py-1.5 text-left text-xs transition-colors hover:bg-white/5",
                  entry.is_git ? "text-cyan-400" : "text-zinc-400",
                )}
              >
                <span className="shrink-0 text-[10px]">{entry.is_git ? "●" : "▸"}</span>
                <span className="flex-1 truncate">{entry.name}</span>
                {entry.is_git && <span className="shrink-0 text-[9px] text-cyan-600">git</span>}
              </button>
            ))}
        </div>

        {/* Footer hint */}
        <div className="border-t border-white/5 px-5 py-2">
          <p className="text-[10px] text-zinc-600">Click to navigate, double-click to select</p>
        </div>
      </div>
    </div>
  );
}
