// R-panel accordion section primitive.
//
// One container of the 7 inventory rows (approach
// `doc/approaches/2026-05-29-r-panel-as-project-artifact-inventory.md`
// §"表示形式 = accordion + 全 collapse default"). All sections share
// this primitive so the negative-space rules are observable in one
// place:
//
//   - header glyph + label + plain count fact (no severity styling);
//   - collapsed by default; only operator-toggled expand;
//   - count uses `text-subtle-foreground` ONLY — never warning /
//     destructive / success accents. The R panel's whole job is to
//     show the inventory without tmai-side appraisal. The one trailing
//     addition is the remote-Δ `unobservedCount` badge (#822): info-tone
//     because it is a neutral freshness fact, never the owed amber.
//
// `id` is the persistence key (string slug) the parent uses to
// remember which sections the operator has expanded across reloads.

import type { ReactNode } from "react";

interface SectionProps {
  id: string;
  /** Single glyph or short symbol shown to the left of the label. */
  glyph: string;
  label: string;
  /** Plain mechanical count (e.g. `3 open`, `12`). Rendered as
   *  `text-subtle-foreground` so it carries zero severity meaning. */
  count: string;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
  /** Optional trailing note rendered in the header, right of the count
   *  (the badge supplies its own `ml-auto`). Used by the PR / Issue
   *  sections to carry the "EXTERNAL · github = source of truth" framing
   *  (C2) — those are the github-resident artifacts on this panel. */
  headerNote?: ReactNode;
  /** Remote-Δ freshness (#822): how many of this section's rows are
   *  UNOBSERVED (vocab timestamp newer than the operator's close-act
   *  cursor). Shown on the header ONLY while the section is collapsed —
   *  open sections accent the rows themselves. Info-tone (cyan family),
   *  never the warning/owed amber: this is a neutral freshness FACT
   *  ("changed since you last looked"), not a tmai-side appraisal, so it
   *  does not breach the count rule above. `undefined` = the section has
   *  no freshness wiring (e.g. isolation tests). */
  unobservedCount?: number;
}

export function Section({
  id,
  glyph,
  label,
  count,
  expanded,
  onToggle,
  children,
  headerNote,
  unobservedCount,
}: SectionProps) {
  return (
    <section data-testid={`r-section-${id}`} data-expanded={expanded ? "true" : "false"}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={`r-section-body-${id}`}
        className="flex w-full items-baseline gap-2 rounded px-1 py-1 text-left transition-colors hover:bg-surface-strong/40"
      >
        <span aria-hidden="true" className="font-mono text-subtle-foreground">
          {expanded ? "▾" : "▸"}
        </span>
        <span className="text-base text-foreground" aria-hidden="true">
          {glyph}
        </span>
        <h3 className="text-sm font-semibold text-foreground">{label}</h3>
        <span className="text-[11px] text-subtle-foreground">{count}</span>
        {!expanded && unobservedCount !== undefined && unobservedCount > 0 && (
          <span
            data-testid={`r-section-unobserved-${id}`}
            title={`${unobservedCount} unobserved remote ${unobservedCount === 1 ? "change" : "changes"} since you last looked`}
            className="font-mono text-[10px] text-info"
          >
            Δ{unobservedCount}
          </span>
        )}
        {headerNote}
      </button>
      {expanded && (
        <div id={`r-section-body-${id}`} className="mt-1 pl-6 text-xs text-muted-foreground">
          {children}
        </div>
      )}
    </section>
  );
}
