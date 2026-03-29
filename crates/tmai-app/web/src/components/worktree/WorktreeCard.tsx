import type { WorktreeSnapshot } from "@/lib/api";
import { cn } from "@/lib/utils";

interface WorktreeCardProps {
  worktree: WorktreeSnapshot;
  selected?: boolean;
  onClick?: () => void;
}

// Sidebar card for an orphan worktree (no agent assigned)
export function WorktreeCard({ worktree, selected, onClick }: WorktreeCardProps) {
  const ds = worktree.diff_summary;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "glass-card w-full rounded-xl px-3 py-2 text-left transition-all",
        selected && "!border-emerald-500/30 !bg-emerald-500/10",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 truncate">
          <span className="text-[10px] text-emerald-500">🌿</span>
          <span className="truncate text-sm font-medium text-zinc-200">
            {worktree.branch || worktree.name}
          </span>
          {worktree.is_dirty && <span className="text-[10px] text-amber-500">*</span>}
        </div>
        {ds && (
          <span className="shrink-0 text-[10px] text-zinc-500">
            <span className="text-emerald-400">+{ds.insertions}</span>{" "}
            <span className="text-red-400">-{ds.deletions}</span>
          </span>
        )}
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-xs text-zinc-600">
        <span>No agent</span>
        {ds && (
          <>
            <span>·</span>
            <span>
              {ds.files_changed} file{ds.files_changed !== 1 ? "s" : ""}
            </span>
          </>
        )}
      </div>
    </button>
  );
}
