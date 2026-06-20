import { useEffect, useState } from "react";
import { DirBrowser } from "@/components/project/DirBrowser";
import { api } from "@/lib/api";

interface ProducerLaunchPickerProps {
  /** Whether the directory picker is open. */
  open: boolean;
  /** Close the picker without launching (backdrop / cancel / post-launch). */
  onClose: () => void;
  /** Launch a Producer at the picked repo root — App's `launchProducerAt`,
   *  which derives the unit name from the path basename and spawns via the
   *  existing `/api/spawn` (no new launch endpoint — #788). */
  onLaunchProducerAt: (path: string) => void;
}

// Modal repo-root picker that LAUNCHES a Producer at the chosen directory —
// the aim-console's "add unit = launch a Producer" path. The launch DEFINES
// the unit: the launch cwd becomes the project (aim `producer-cwd`), which is
// the bootstrap the `producer-slot-invariant` safety-net presupposes (it only
// re-spawns slots that already have a live Producer; the FIRST occupant must
// come from an explicit launch act like this one).
//
// Reuses `DirBrowser` and the `actionSlot` "Launch Producer here" affordance
// exactly as `ProducerConsoleActions` does for the legacy console, so both
// surfaces drive the same `/api/spawn` launch path.
export function ProducerLaunchPicker({
  open,
  onClose,
  onLaunchProducerAt,
}: ProducerLaunchPickerProps) {
  const [defaultRoot, setDefaultRoot] = useState<string | null>(null);

  // Pull `[general] default_project_root` lazily on open so an edit in
  // GeneralSection flips the picker's start dir on the next open without a
  // reload. A transient fetch failure just leaves `defaultRoot = null` and
  // `DirBrowser` falls back to `~`. (Mirrors `ProducerConsoleActions`.)
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const g = await api.getGeneralSettings();
        if (!cancelled) setDefaultRoot(g.default_project_root);
      } catch {
        // intentional no-op — see comment above.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  return (
    <DirBrowser
      startPath={defaultRoot ?? undefined}
      onCancel={onClose}
      actionSlot={(currentPath) => (
        <div className="flex w-full flex-col gap-1.5">
          <button
            type="button"
            onClick={() => {
              onClose();
              onLaunchProducerAt(currentPath);
            }}
            disabled={!currentPath}
            className="w-full rounded bg-primary/10 px-3 py-1.5 text-center text-xs text-primary transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Launch Producer here ▸
          </button>
          <p className="text-[10px] text-subtle-foreground">
            tmai will spawn{" "}
            <code className="text-muted-foreground">tmai producer &lt;basename&gt;</code> in the
            chosen repo — the launch cwd defines the unit.
          </p>
        </div>
      )}
    />
  );
}
