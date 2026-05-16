import { useCallback, useEffect, useRef, useState } from "react";
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
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

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
    <div className="rounded-lg border border-success/20 bg-success/5 p-2">
      <div className="mb-1 text-[11px] text-muted-foreground">
        from: <span className="text-success">{baseBranch}</span>
      </div>
      {depth + 1 >= depthWarning && (
        <div className="mb-2 rounded bg-warning/10 px-2 py-1.5 text-[11px] text-warning">
          This will be {depth + 1} levels deep from main. Consider merging the parent branch first.
        </div>
      )}
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
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
          className="flex-1 rounded bg-background px-2 py-1 text-xs text-foreground placeholder-subtle-foreground outline-none ring-1 ring-success/30 focus:ring-success/60"
        />
        <button
          type="button"
          onClick={handleCreate}
          disabled={!name.trim() || busy}
          className="rounded px-2 py-1 text-xs text-success hover:bg-success/10 disabled:opacity-30"
        >
          Go
        </button>
      </div>
      {error && <span className="text-[10px] text-destructive">{error}</span>}
    </div>
  );
}
