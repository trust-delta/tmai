import { useCallback, useEffect, useState } from "react";
import { DirBrowser } from "@/components/project/DirBrowser";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface NewAgentLauncherProps {
  onSpawned: (sessionId: string) => void;
}

const RUNTIMES = ["claude", "codex", "bash"] as const;
type Runtime = (typeof RUNTIMES)[number];

/**
 * Top-of-sidebar launcher: pick a directory via DirBrowser, then choose a
 * runtime (claude / codex / bash) to spawn.  Replaces the per-project `+`
 * menu as the entry point for brand-new project work — the per-project `+`
 * inside `ProjectGroup` stays for adding agents to projects already shown
 * in the sidebar.
 */
export function NewAgentLauncher({ onSpawned }: NewAgentLauncherProps) {
  const [browsing, setBrowsing] = useState(false);
  const [pickedDir, setPickedDir] = useState<string | null>(null);
  const [spawning, setSpawning] = useState(false);
  const [error, setError] = useState("");
  const [defaultRoot, setDefaultRoot] = useState<string | null>(null);

  // Seeded from `[general] default_project_root` so the picker opens at the
  // user's preferred root instead of `~`. AgentList (our parent) un-mounts
  // while Settings is open, so re-fetching on mount is enough to pick up
  // edits made in the GeneralSection without a manual refresh hook.
  useEffect(() => {
    api
      .getGeneralSettings()
      .then((g) => setDefaultRoot(g.default_project_root))
      .catch(() => {});
  }, []);

  const handleDirSelected = useCallback((path: string) => {
    setPickedDir(path);
    setBrowsing(false);
    setError("");
  }, []);

  const handleSpawn = useCallback(
    async (runtime: Runtime) => {
      if (!pickedDir || spawning) return;
      setSpawning(true);
      setError("");
      try {
        const res = await api.spawnPty({ command: runtime, cwd: pickedDir });
        onSpawned(res.session_id);
        setPickedDir(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to spawn");
      } finally {
        setSpawning(false);
      }
    },
    [pickedDir, spawning, onSpawned],
  );

  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setBrowsing(true)}
        disabled={spawning}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-zinc-400 transition-colors hover:border-cyan-500/30 hover:bg-cyan-500/5 hover:text-cyan-300 disabled:opacity-50"
      >
        <span className="text-sm leading-none">+</span>
        <span>New agent</span>
      </button>

      {pickedDir && (
        <div className="mt-2 rounded-lg border border-white/10 bg-white/[0.03] p-2">
          <div className="flex items-center gap-2 text-[11px] text-zinc-500">
            <span className="truncate" title={pickedDir}>
              {pickedDir}
            </span>
            <button
              type="button"
              onClick={() => setPickedDir(null)}
              className="ml-auto shrink-0 rounded px-1.5 py-0.5 text-zinc-600 transition-colors hover:bg-white/10 hover:text-zinc-300"
            >
              Cancel
            </button>
          </div>
          <div className="mt-1.5 flex gap-1">
            {RUNTIMES.map((rt) => (
              <button
                key={rt}
                type="button"
                onClick={() => void handleSpawn(rt)}
                disabled={spawning}
                className={cn(
                  "flex-1 rounded px-2 py-1 text-center text-[11px] transition-colors",
                  "text-zinc-300 hover:bg-cyan-500/10 hover:text-cyan-400 disabled:opacity-50",
                )}
              >
                {rt}
              </button>
            ))}
          </div>
          {error && (
            <p role="alert" aria-live="assertive" className="mt-1.5 text-[11px] text-red-400">
              {error}
            </p>
          )}
        </div>
      )}

      {browsing && (
        <DirBrowser
          startPath={defaultRoot ?? undefined}
          onSelect={handleDirSelected}
          onCancel={() => setBrowsing(false)}
        />
      )}
    </div>
  );
}
