// Persistent right-hand attention strip — P1 of the L/C/R co-visible
// re-layout (`doc/decisions/2026-05-14-react-producer-console-rebuild.md`
// §Refinement 2026-05-22).
//
// WHY this exists: before P1, selecting an agent (the Producer
// conversation = PreviewPanel) *replaced* the ProducerConsole digest in
// the single `<main>`, and `returnToConsole` was the only way back. So
// the operator could not read the attention surface and converse at the
// same time — the digest↔conversation screen-switch the refinement set
// out to kill. This strip is mounted in `App.tsx` as a sibling of
// `<main>` (a third flex column), OUTSIDE the `selection` switch, so it
// stays co-visible with whatever the centre shows — digest, Producer
// conversation, or the git/docs multipane (P2 retires the latter; P1
// leaves it in place).
//
// Fork A — DUMB SUBSET: the strip is attention-grade status only. It
// reuses the existing self-contained Producer-console sections in a
// width-constrained form:
//   ▶ blocked / awaiting agents   (WhereYouLeftOffSection, attentionOnly)
//   ▣ verdict-awaiting approaches  (ActiveApproachesSection)
//   🔀 open PRs + CI               (UnitPrsSection)
//   ⬢ cross-unit needs-you         (CrossUnitStatusSection)
// The heavy context (full ⬡ Settled decisions list, ◐ Working-with-this-
// human / MEMORY) deliberately stays in the on-demand centre digest, not
// here. Per the pre-producer-dashboard convergence
// (`doc/decisions/2026-05-20-provisional-pre-producer-dashboard.md`) this
// is a dumb status surface: no priority scalar, no anomaly sort, no
// re-ranking — the section order below is a fixed reading order, not a
// judgment. The always-on TripwireBanner lives in `App.tsx` above the
// centre and is not duplicated here.

import { useHandover } from "@/hooks/useHandover";
import { ActiveApproachesSection } from "./sections/ActiveApproachesSection";
import { CrossUnitStatusSection } from "./sections/CrossUnitStatusSection";
import { UnitPrsSection } from "./sections/UnitPrsSection";
import { WhereYouLeftOffSection } from "./sections/WhereYouLeftOffSection";

interface AttentionStripProps {
  /** Currently focused project (App.tsx's `currentProject`). Scopes the
   *  ▶ attention list and the unit for the PR / approaches sections. */
  currentProjectPath: string | null;
  /** Unit name — basename of `currentProjectPath`. Drives the wire-backed
   *  PR / approaches sections (`resolve_unit_or_cwd` falls back to the
   *  basename when no `[[unit]]` table matches). */
  unitName: string | null;
  /** Wired to App.tsx's `handleSelectProject` so picking a unit in the
   *  strip matches sidebar / centre-digest selection exactly. */
  onSelectProjectByPath: (path: string, name: string) => void;
  /** Collapsed = folded to a thin rail (operator reclaims width when the
   *  centre is busy). Persisted by App.tsx via the `attentionStripCollapsed`
   *  UI pref. */
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

export function AttentionStrip({
  currentProjectPath,
  unitName,
  onSelectProjectByPath,
  collapsed,
  onToggleCollapsed,
}: AttentionStripProps) {
  const { whereYouLeftOff, crossUnit, missingPreconditions } = useHandover(currentProjectPath);

  if (collapsed) {
    return (
      <aside
        data-testid="attention-strip"
        data-collapsed="true"
        className="glass flex w-9 shrink-0 flex-col items-center border-l border-hairline py-2"
      >
        <button
          type="button"
          onClick={onToggleCollapsed}
          title="Expand attention strip"
          aria-label="Expand attention strip"
          aria-expanded={false}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-strong hover:text-foreground"
        >
          ‹
        </button>
        {/* Vertical label so the rail still reads as the attention surface
            even when folded. `writing-mode` keeps it on one rotated line. */}
        <span
          className="mt-2 select-none text-[10px] uppercase tracking-widest text-subtle-foreground"
          style={{ writingMode: "vertical-rl" }}
        >
          Attention
        </span>
      </aside>
    );
  }

  return (
    <aside
      data-testid="attention-strip"
      data-collapsed="false"
      className="glass flex w-80 shrink-0 flex-col border-l border-hairline"
    >
      <header className="flex shrink-0 items-center justify-between border-b border-hairline px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">Attention</h2>
        <button
          type="button"
          onClick={onToggleCollapsed}
          title="Collapse attention strip"
          aria-label="Collapse attention strip"
          aria-expanded={true}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-strong hover:text-foreground"
        >
          ›
        </button>
      </header>

      <div className="flex-1 space-y-6 overflow-y-auto px-4 py-4 text-sm">
        <WhereYouLeftOffSection data={whereYouLeftOff} attentionOnly />
        <ActiveApproachesSection unitName={unitName} />
        <UnitPrsSection unitName={unitName} />
        <CrossUnitStatusSection
          data={crossUnit}
          activePath={currentProjectPath}
          onSelectUnit={onSelectProjectByPath}
          preconditions={missingPreconditions}
        />
      </div>
    </aside>
  );
}
