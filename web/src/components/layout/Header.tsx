import { useState } from "react";
import { useThemeStore, syncThemeToBackend } from "../../stores/theme";
import type { Theme } from "../../stores/theme";
import { ConnectionIndicator } from "../common/ConnectionIndicator";
import { SpawnDialog } from "../spawn/SpawnDialog";
import { OrchestratorSettingsPanel } from "../settings/OrchestratorSettings";

interface HeaderProps {
  connected: boolean;
}

/** Icon and label for each theme mode */
const themeIcon: Record<Theme, string> = {
  dark: "\u{1F319}",
  light: "\u{2600}\u{FE0F}",
  system: "\u{1F4BB}",
};
const themeLabel: Record<Theme, string> = {
  dark: "Dark",
  light: "Light",
  system: "System",
};

export function Header({ connected }: HeaderProps) {
  const { theme, cycle } = useThemeStore();
  const [showSpawn, setShowSpawn] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  /** Cycle theme and sync to backend */
  function handleToggle() {
    cycle();
    const next = useThemeStore.getState().theme;
    syncThemeToBackend(next);
  }

  return (
    <>
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-neutral-300 bg-neutral-200 px-4 dark:border-neutral-800 dark:bg-transparent">
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold tracking-tight">tmai</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowSpawn(true)}
            className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-500"
            title="Spawn a new agent"
          >
            + Spawn
          </button>
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            className="rounded p-1.5 text-sm hover:bg-neutral-200 dark:hover:bg-neutral-800"
            title="Orchestrator Settings"
          >
            &#9881;
          </button>
          <ConnectionIndicator connected={connected} />
          <button
            type="button"
            onClick={handleToggle}
            className="rounded p-1.5 text-sm hover:bg-neutral-200 dark:hover:bg-neutral-800"
            aria-label={`Theme: ${themeLabel[theme]}`}
            title={`Theme: ${themeLabel[theme]}`}
          >
            {themeIcon[theme]}
          </button>
        </div>
      </header>
      {showSpawn && <SpawnDialog onClose={() => setShowSpawn(false)} />}
      {showSettings && (
        <OrchestratorSettingsPanel onClose={() => setShowSettings(false)} />
      )}
    </>
  );
}
