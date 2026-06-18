// Unit-tab strip for the top bar (C1, Stage C aim-console convergence).
//
// One tab per configured `[[unit]]` (from `useUnits` → `UnitsResponse`),
// each showing the unit's repos as pills (primary highlighted vs secondary)
// plus an attention rollup badge (⚠N). The active unit is highlighted;
// clicking a tab re-scopes the focused unit. A trailing `+` conveys "add
// unit = launch Producer" (a clipboard/toast placeholder — no new launch
// endpoint, mirroring the existing Phase-A "Open Producer terminal"
// pattern). Mock reference: `origin/mock/aim-ui-sample` top bar.
//
// Each tab also carries a per-unit CLOSE affordance (×) bound to the
// Producer-slot terminal (tmai-core #540 / #546): it kills the unit's
// Producer + dispatched workers (and the webui's footer bash). Because
// close is a kill — Producer + workers gone, but worktrees / uncommitted
// work stay on disk — it is gated behind an always-on confirm dialog
// (`useConfirm`); only on confirm does it call `onCloseUnit`.
//
// Built to render N units; one configured unit today collapses to a single
// tab. The attention rollup lives in a per-unit child (`UnitTab`) so each
// tab can call `useUnitAttention(unit)` on its own — scaling to N without a
// rules-of-hooks violation.

import { useConfirm } from "@/components/layout/ConfirmDialog";
import { useUnitAttention } from "@/hooks/useUnitAttention";
import type { UnitResponse } from "@/lib/api";
import { cn } from "@/lib/utils";

function repoBasename(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

interface UnitTabsProps {
  units: UnitResponse[];
  /** Name of the currently focused unit (App derives it from the selected
   *  project's basename), so the matching tab highlights. */
  activeUnitName: string | null;
  /** Re-scope the focused unit to the clicked one. */
  onSelectUnit: (unit: UnitResponse) => void;
  /** "Add unit = launch Producer" affordance (placeholder/clipboard). */
  onAddUnit: () => void;
  /** Close the unit's Producer slot (kill Producer + workers + footer bash).
   *  Called ONLY after the per-tab confirm dialog is accepted. */
  onCloseUnit: (unit: UnitResponse) => void;
}

export function UnitTabs({
  units,
  activeUnitName,
  onSelectUnit,
  onAddUnit,
  onCloseUnit,
}: UnitTabsProps) {
  return (
    <div data-testid="unit-tabs" className="flex flex-wrap items-center gap-1">
      {units.map((unit) => (
        <UnitTab
          key={unit.name}
          unit={unit}
          active={unit.name === activeUnitName}
          onSelect={() => onSelectUnit(unit)}
          onClose={() => onCloseUnit(unit)}
        />
      ))}
      <button
        type="button"
        onClick={onAddUnit}
        title="Add unit = launch a Producer in a unit's primary repo"
        aria-label="Add unit — launch Producer"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-hairline-strong/40 text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
      >
        +
      </button>
    </div>
  );
}

function UnitTab({
  unit,
  active,
  onSelect,
  onClose,
}: {
  unit: UnitResponse;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
}) {
  // Per-unit attention rollup: count the operator-set `high` markers across
  // this unit's artifacts (the ⚠N "owed attention" badge). Reuses the
  // existing `useUnitAttention` wire — no new endpoint (issue #788 C1).
  const { data } = useUnitAttention(unit.name);
  const highCount = data?.entries.filter((e) => e.level === "high").length ?? 0;

  // Always-on confirm gate (#540 companion): close = kill, so never silent.
  const confirm = useConfirm();
  const handleClose = async () => {
    const ok = await confirm({
      title: `Close unit ${unit.name}?`,
      message:
        "Close kills this unit's Producer, its dispatched workers, and its footer bash. " +
        "This is a kill, not a delete — worktrees and uncommitted work stay on disk.",
      confirmLabel: "Close unit",
      cancelLabel: "Cancel",
      variant: "danger",
    });
    if (ok) onClose();
  };

  return (
    <div
      data-testid={`unit-tab-${unit.name}`}
      className={cn(
        "flex shrink-0 items-center rounded-t border-b-2 transition-colors",
        active ? "border-primary" : "border-transparent hover:bg-surface-strong",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? "true" : undefined}
        // Explicit label so the tab's accessible name is the unit (the
        // content is just repo-basename pills + an icon badge).
        aria-label={`unit: ${unit.name}`}
        title={`unit: ${unit.name}`}
        className={cn(
          "flex items-center gap-1.5 px-2 py-1",
          active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
        )}
      >
        {unit.repos.map((repo) => (
          <RepoPill key={repo.path} label={repoBasename(repo.path)} primary={repo.primary} />
        ))}
        {highCount > 0 && (
          <span
            data-testid="unit-attention-rollup"
            title={`${highCount} owed attention`}
            className="rounded bg-warning/15 px-1 font-mono text-[9px] text-warning"
          >
            ⚠{highCount}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={handleClose}
        // No colon (avoid colliding with the select button's `unit: <name>`
        // accessible name under a loose name matcher).
        aria-label={`Close unit ${unit.name}`}
        title={`Close unit ${unit.name} — kill Producer + workers + footer bash (worktrees stay)`}
        className="mr-1 flex h-4 w-4 shrink-0 items-center justify-center rounded text-[11px] leading-none text-subtle-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
      >
        ×
      </button>
    </div>
  );
}

function RepoPill({ label, primary }: { label: string; primary: boolean }) {
  return (
    <span
      data-testid="repo-pill"
      data-primary={primary ? "true" : "false"}
      className={cn(
        "rounded border px-1 font-mono text-[9px] tracking-wide",
        // Primary repo (where the Producer launches) gets the themed accent
        // ring; secondary repos stay quiet. Categorical, not severity.
        primary
          ? "border-info/40 bg-info/10 text-info"
          : "border-hairline-strong/40 text-muted-foreground",
      )}
    >
      {label}
    </span>
  );
}
