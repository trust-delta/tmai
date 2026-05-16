import { useEffect, useState } from "react";
import { useSaveTracker } from "@/hooks/useSaveTracker";
import { api, type SpawnSettings } from "@/lib/api";
import { SaveStatus } from "./SaveStatus";
import { SpawnRuntimeSelector } from "./SpawnRuntimeSelector";

/**
 * Spawn settings section: runtime selector (native / tmux) + the tmux
 * window-name field that's only relevant when runtime = "tmux".
 *
 * Owns its own state and load (`api.getSpawnSettings`). Auto-saves on
 * every interaction via `useSaveTracker`.
 */
export function SpawnSection() {
  const [spawn, setSpawn] = useState<SpawnSettings | null>(null);
  const save = useSaveTracker();

  useEffect(() => {
    api.getSpawnSettings().then(setSpawn).catch(console.error);
  }, []);

  if (!spawn) return null;

  // Window-name commits on blur or Enter (text-field commit; no rollback so
  // the user can edit and retry if the backend rejects the value).
  const commitWindowName = () => {
    const trimmed = spawn.tmux_window_name.trim();
    if (!trimmed) return;
    void save.track(() =>
      api.updateSpawnSettings({ runtime: spawn.runtime, tmux_window_name: trimmed }),
    );
  };

  return (
    <section>
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium text-foreground">Spawn</h3>
        <SaveStatus status={save.status} error={save.error} variant="section" />
      </div>
      <p className="mt-1 text-xs text-subtle-foreground">
        How new agents are started from the Web UI.
      </p>

      <div className="mt-3 rounded-lg border border-hairline-strong bg-surface p-3 space-y-3">
        <SpawnRuntimeSelector settings={spawn} onSettingsChange={setSpawn} save={save} />

        {/* Window name field — shown when runtime is tmux */}
        {spawn.runtime === "tmux" && (
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-xs text-muted-foreground">Window name</span>
            <input
              type="text"
              value={spawn.tmux_window_name}
              onChange={(e) => {
                save.clearError();
                setSpawn({ ...spawn, tmux_window_name: e.target.value });
              }}
              onBlur={commitWindowName}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  (e.currentTarget as HTMLInputElement).blur();
                }
              }}
              className="flex-1 rounded-md border border-hairline-strong bg-surface px-2.5 py-1 text-xs text-foreground outline-none focus:border-primary/30"
              aria-label="tmux window name"
            />
          </div>
        )}
      </div>
    </section>
  );
}
