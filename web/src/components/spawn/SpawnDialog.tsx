import { useState } from "react";
import { spawnAgent } from "../../api/client";
import { useAgentsStore } from "../../stores/agents";

interface SpawnDialogProps {
  onClose: () => void;
}

/** Dialog for spawning a new agent in a PTY session */
export function SpawnDialog({ onClose }: SpawnDialogProps) {
  const [command, setCommand] = useState("bash");
  const [args, setArgs] = useState("");
  const [cwd, setCwd] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [spawning, setSpawning] = useState(false);

  const handleSpawn = async () => {
    setError(null);
    setSpawning(true);

    try {
      const argList = args
        .split(/\s+/)
        .filter((a) => a.length > 0);
      const result = await spawnAgent(
        command,
        argList,
        cwd || undefined,
      );

      // Create a temporary agent entry so the user can see it immediately
      const agents = useAgentsStore.getState().agents;
      const tempAgent = {
        id: result.session_id,
        agent_type: command,
        status: { type: "processing" as const, message: "Starting..." },
        cwd: cwd || "~",
        session: "pty",
        window_name: command,
        needs_attention: false,
        is_virtual: false,
        team: null,
        mode: "",
        pty_session_id: result.session_id,
      };
      useAgentsStore.setState({
        agents: [...agents, tempAgent],
        selectedAgentId: result.session_id,
      });

      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Spawn failed");
    } finally {
      setSpawning(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-lg border border-neutral-300 bg-white p-6 shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
        <h2 className="mb-4 text-lg font-bold">Spawn Agent</h2>

        <div className="space-y-3">
          {/* Command */}
          <div>
            <label className="mb-1 block text-sm text-neutral-700 dark:text-neutral-400">
              Command
            </label>
            <select
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              className="w-full rounded border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-neutral-600 dark:bg-neutral-800"
            >
              <option value="bash">bash</option>
              <option value="claude">claude</option>
              <option value="codex">codex</option>
              <option value="gemini">gemini</option>
              <option value="zsh">zsh</option>
              <option value="sh">sh</option>
            </select>
          </div>

          {/* Arguments */}
          <div>
            <label className="mb-1 block text-sm text-neutral-700 dark:text-neutral-400">
              Arguments
            </label>
            <input
              type="text"
              value={args}
              onChange={(e) => setArgs(e.target.value)}
              placeholder="e.g. --debug"
              className="w-full rounded border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-neutral-600 dark:bg-neutral-800"
            />
          </div>

          {/* Working directory */}
          <div>
            <label className="mb-1 block text-sm text-neutral-700 dark:text-neutral-400">
              Working Directory
            </label>
            <input
              type="text"
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              placeholder="(server default)"
              className="w-full rounded border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-neutral-600 dark:bg-neutral-800"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={onClose}
              className="rounded px-4 py-2 text-sm hover:bg-neutral-200 dark:hover:bg-neutral-800"
            >
              Cancel
            </button>
            <button
              onClick={handleSpawn}
              disabled={spawning}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {spawning ? "Spawning..." : "Spawn"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
