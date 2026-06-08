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
// Built to render N units; one configured unit today collapses to a single
// tab. The attention rollup lives in a per-unit child (`UnitTab`) so each
// tab can call `useUnitAttention(unit)` on its own — scaling to N without a
// rules-of-hooks violation.

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
}

export function UnitTabs({ units, activeUnitName, onSelectUnit, onAddUnit }: UnitTabsProps) {
  return (
    <div data-testid="unit-tabs" className="flex flex-wrap items-center gap-1">
      {units.map((unit) => (
        <UnitTab
          key={unit.name}
          unit={unit}
          active={unit.name === activeUnitName}
          onSelect={() => onSelectUnit(unit)}
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
}: {
  unit: UnitResponse;
  active: boolean;
  onSelect: () => void;
}) {
  // Per-unit attention rollup: count the operator-set `high` markers across
  // this unit's artifacts (the ⚠N "owed attention" badge). Reuses the
  // existing `useUnitAttention` wire — no new endpoint (issue #788 C1).
  const { data } = useUnitAttention(unit.name);
  const highCount = data?.entries.filter((e) => e.level === "high").length ?? 0;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "true" : undefined}
      // Explicit label so the tab's accessible name is the unit (the
      // content is just repo-basename pills + an icon badge).
      aria-label={`unit: ${unit.name}`}
      title={`unit: ${unit.name}`}
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-t border-b-2 px-2 py-1 transition-colors",
        active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:bg-surface-strong hover:text-foreground",
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
