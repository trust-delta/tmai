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
 * Top-of-sidebar launcher: open DirBrowser, navigate to the desired folder,
 * and pick a runtime (claude / codex / bash) inline to spawn there.  The
 * runtime buttons live inside the DirBrowser via its `actionSlot` prop —
 * earlier versions split this across "Select this" + a secondary runtime
 * picker, which made every spawn a two-step round trip through a closing
 * modal.  The per-project `+` inside `ProjectGroup` stays for adding agents
 * to projects already shown in the sidebar.
 */
export function NewAgentLauncher({ onSpawned }: NewAgentLauncherProps) {
  const [browsing, setBrowsing] = useState(false);
  const [spawning, setSpawning] = useState(false);
  const [error, setError] = useState("");
  const [defaultRoot, setDefaultRoot] = useState<string | null>(null);

  // `[general] default_project_root` seeds DirBrowser's start path. AgentList
  // (our parent) lives in the always-mounted sidebar — it does NOT unmount
  // when Settings opens, contrary to what an earlier comment here claimed —
  // so we have to re-fetch every time the user opens the picker, otherwise
  // an edit in GeneralSection won't show up until a hard reload.
  const refreshDefaultRoot = useCallback(async () => {
    try {
      const g = await api.getGeneralSettings();
      setDefaultRoot(g.default_project_root);
    } catch {
      // Leave the previous value in place — a transient fetch failure
      // shouldn't reset the user's configured root to null.
    }
  }, []);
  useEffect(() => {
    void refreshDefaultRoot();
  }, [refreshDefaultRoot]);

  const handleOpenBrowser = useCallback(async () => {
    // Await the fetch before opening so DirBrowser mounts with the latest
    // startPath in one shot — opening first and updating on the next render
    // would briefly flash the previous root's listing.
    await refreshDefaultRoot();
    setError("");
    setBrowsing(true);
  }, [refreshDefaultRoot]);

  const handleSpawn = useCallback(
    async (runtime: Runtime, cwd: string) => {
      if (!cwd || spawning) return;
      setSpawning(true);
      setError("");
      try {
        const res = await api.spawnPty({ command: runtime, cwd });
        onSpawned(res.session_id);
        setBrowsing(false);
      } catch (e) {
        // Surface which runtime was tried so users can tell apart
        // "claude is mis-installed" from "this directory can't host
        // anything" when only one of the three buttons fails.
        const reason = e instanceof Error ? e.message : "Failed to spawn";
        setError(`Failed to spawn ${runtime}: ${reason}`);
      } finally {
        setSpawning(false);
      }
    },
    [spawning, onSpawned],
  );

  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => void handleOpenBrowser()}
        disabled={spawning}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-hairline-strong bg-surface px-3 py-2 text-xs text-muted-foreground transition-colors hover:border-primary/30 hover:bg-primary/5 hover:text-primary disabled:opacity-50"
      >
        <span className="text-sm leading-none">+</span>
        <span>New agent</span>
      </button>

      {browsing && (
        <DirBrowser
          startPath={defaultRoot ?? undefined}
          onCancel={() => setBrowsing(false)}
          actionSlot={(currentPath) => (
            <div className="flex w-full flex-col gap-1.5">
              <div className="flex gap-1">
                {RUNTIMES.map((rt) => (
                  <button
                    key={rt}
                    type="button"
                    onClick={() => void handleSpawn(rt, currentPath)}
                    disabled={spawning || !currentPath}
                    className={cn(
                      "flex-1 rounded px-2 py-1 text-center text-[11px] transition-colors",
                      "text-foreground hover:bg-primary/10 hover:text-primary disabled:opacity-50",
                    )}
                  >
                    {rt}
                  </button>
                ))}
              </div>
              {error && (
                <p role="alert" aria-live="assertive" className="text-[11px] text-destructive">
                  {error}
                </p>
              )}
            </div>
          )}
        />
      )}
    </div>
  );
}
