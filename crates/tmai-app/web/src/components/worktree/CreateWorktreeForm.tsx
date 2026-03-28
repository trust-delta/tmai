import { useState, useCallback } from "react";
import { api } from "@/lib/api";

interface CreateWorktreeFormProps {
  baseBranch: string;
  depth: number;
  depthWarning: number;
  projectPath: string;
  onCreated: () => void;
  onCancel: () => void;
}

// Inline form for creating a new worktree from a base branch
export function CreateWorktreeForm({
  baseBranch,
  depth,
  depthWarning,
  projectPath,
  onCreated,
  onCancel,
}: CreateWorktreeFormProps) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const handleCreate = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    if (!/^[a-zA-Z0-9_-]+$/.test(trimmed) || trimmed.length > 64) {
      setError("a-z, 0-9, -, _ only (max 64)");
      return;
    }
    setBusy(true);
    try {
      await api.spawnWorktree({ name: trimmed, cwd: projectPath, base_branch: baseBranch });
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create worktree");
    } finally {
      setBusy(false);
    }
  }, [name, busy, projectPath, baseBranch, onCreated]);

  return (
    <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2">
      <div className="mb-1 text-[11px] text-zinc-500">
        from: <span className="text-emerald-400">{baseBranch}</span>
      </div>
      {depth + 1 >= depthWarning && (
        <div className="mb-2 rounded bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-400">
          This will be {depth + 1} levels deep from main. Consider merging the parent branch first.
        </div>
      )}
      <div className="flex items-center gap-1">
        <input
          autoFocus
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleCreate();
            if (e.key === "Escape") onCancel();
          }}
          placeholder="worktree name"
          className="flex-1 rounded bg-black/30 px-2 py-1 text-xs text-zinc-200 placeholder-zinc-600 outline-none ring-1 ring-emerald-500/30 focus:ring-emerald-500/60"
        />
        <button
          onClick={handleCreate}
          disabled={!name.trim() || busy}
          className="rounded px-2 py-1 text-xs text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-30"
        >
          Go
        </button>
      </div>
      {error && <span className="text-[10px] text-red-400">{error}</span>}
    </div>
  );
}
