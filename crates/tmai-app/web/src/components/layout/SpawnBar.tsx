import { useState } from "react";
import { api } from "@/lib/tauri";

interface SpawnBarProps {
  onSpawned: (target: string) => void;
}

// Bottom bar for spawning new agents
export function SpawnBar({ onSpawned }: SpawnBarProps) {
  const [spawning, setSpawning] = useState(false);

  const spawn = async (command: string) => {
    if (spawning) return;
    setSpawning(true);
    try {
      const res = await api.spawnPty({ command });
      onSpawned(res.sessionId);
    } catch (e) {
      console.error("Spawn failed:", e);
    } finally {
      setSpawning(false);
    }
  };

  return (
    <div className="border-t border-zinc-800 p-2">
      <div className="flex gap-1.5">
        {["claude", "bash"].map((cmd) => (
          <button
            key={cmd}
            onClick={() => spawn(cmd)}
            disabled={spawning}
            className="flex-1 rounded-md bg-zinc-800 px-2 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-700 disabled:opacity-50"
          >
            {cmd}
          </button>
        ))}
      </div>
    </div>
  );
}
