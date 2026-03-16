import { useState } from "react";
import { useThemeStore } from "../../stores/theme";
import { ConnectionIndicator } from "../common/ConnectionIndicator";
import { SpawnDialog } from "../spawn/SpawnDialog";

interface HeaderProps {
  connected: boolean;
}

export function Header({ connected }: HeaderProps) {
  const { theme, toggle } = useThemeStore();
  const [showSpawn, setShowSpawn] = useState(false);

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
          <ConnectionIndicator connected={connected} />
          <button
            type="button"
            onClick={toggle}
            className="rounded p-1.5 text-sm hover:bg-neutral-200 dark:hover:bg-neutral-800"
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          >
            {theme === "dark" ? "🌙" : "☀️"}
          </button>
        </div>
      </header>
      {showSpawn && <SpawnDialog onClose={() => setShowSpawn(false)} />}
    </>
  );
}
