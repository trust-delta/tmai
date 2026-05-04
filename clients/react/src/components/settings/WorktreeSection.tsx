import { useEffect, useState } from "react";
import { useSaveTracker } from "@/hooks/useSaveTracker";
import { api, type WorktreeSettings } from "@/lib/api";
import { SaveStatus } from "./SaveStatus";

const NUMERIC_FIELDS = [
  {
    key: "setup_timeout_secs",
    label: "Setup timeout",
    unit: "seconds",
    min: 30,
    max: 3600,
  },
  {
    key: "branch_depth_warning",
    label: "Branch depth warning",
    unit: "levels",
    min: 1,
    max: 100,
  },
] as const satisfies ReadonlyArray<{
  key: keyof Pick<WorktreeSettings, "setup_timeout_secs" | "branch_depth_warning">;
  label: string;
  unit: string;
  min: number;
  max: number;
}>;

/**
 * Worktree settings section: setup commands list (add / remove) + numeric
 * tunables (setup timeout, branch-depth warning threshold).
 *
 * Owns its own state and load (`api.getWorktreeSettings`) so the parent
 * SettingsPanel does not need to refresh it. Auto-saves on every
 * interaction via `useSaveTracker`; list-mutation roll back on backend
 * error so the rendered list stays in sync with the server.
 */
export function WorktreeSection() {
  const [worktree, setWorktree] = useState<WorktreeSettings | null>(null);
  const [newSetupCommand, setNewSetupCommand] = useState("");
  const save = useSaveTracker();

  useEffect(() => {
    api.getWorktreeSettings().then(setWorktree).catch(console.error);
  }, []);

  if (!worktree) return null;

  const updateCommands = (next: string[]) => {
    const previous = worktree.setup_commands;
    setWorktree({ ...worktree, setup_commands: next });
    void save.track(() => api.updateWorktreeSettings({ setup_commands: next }), {
      onError: () => setWorktree({ ...worktree, setup_commands: previous }),
    });
  };

  const removeCommand = (cmd: string) => {
    updateCommands(worktree.setup_commands.filter((c) => c !== cmd));
  };

  const addCommand = () => {
    const trimmed = newSetupCommand.trim();
    if (!trimmed) return;
    updateCommands([...worktree.setup_commands, trimmed]);
    setNewSetupCommand("");
  };

  return (
    <section>
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium text-zinc-300">Worktree</h3>
        <SaveStatus status={save.status} error={save.error} variant="section" />
      </div>
      <p className="mt-1 text-xs text-zinc-600">Git worktree settings for spawned agents.</p>

      <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.02] p-3 space-y-3">
        {/* Setup commands list */}
        <div>
          <span className="text-xs text-zinc-500">Setup commands</span>
          <p className="text-[10px] text-zinc-600 mt-0.5">
            Commands to run after creating a new worktree (e.g., npm install).
          </p>
          <div className="mt-2 space-y-1">
            {worktree.setup_commands.map((cmd) => (
              <div key={cmd} className="flex items-center gap-1.5">
                <code className="flex-1 rounded bg-white/5 px-2 py-1 text-xs text-zinc-300">
                  {cmd}
                </code>
                <button
                  type="button"
                  onClick={() => removeCommand(cmd)}
                  className="rounded px-1.5 py-0.5 text-[10px] text-zinc-600 hover:bg-red-500/10 hover:text-red-400"
                  aria-label={`Remove setup command ${cmd}`}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-1.5">
            <input
              type="text"
              value={newSetupCommand}
              onChange={(e) => setNewSetupCommand(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCommand();
                }
              }}
              placeholder="e.g., npm install"
              className="flex-1 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-cyan-500/30"
              aria-label="Add setup command"
            />
            <button
              type="button"
              onClick={addCommand}
              className="rounded-md bg-cyan-500/20 px-3 py-1 text-xs text-cyan-400 transition-colors hover:bg-cyan-500/30"
            >
              Add
            </button>
          </div>
        </div>

        {/* Numeric tunables — driven from a small table so adding new fields
            is one row, not a fork-and-rename of the full block. */}
        {NUMERIC_FIELDS.map(({ key, label, unit, min, max }) => (
          <div key={key} className="flex items-center gap-2">
            <span className="shrink-0 text-xs text-zinc-500">{label}</span>
            <input
              type="number"
              min={min}
              max={max}
              value={worktree[key]}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                if (!Number.isNaN(val)) {
                  save.clearError();
                  setWorktree({ ...worktree, [key]: val });
                }
              }}
              onBlur={() => {
                const val = Math.max(min, worktree[key]);
                void save.track(() => api.updateWorktreeSettings({ [key]: val }));
              }}
              className="w-20 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-200 outline-none focus:border-cyan-500/30"
              aria-label={label}
            />
            <span className="text-xs text-zinc-500">{unit}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
