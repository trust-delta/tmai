// 📜 Hand-over — R panel's hand-over baton inventory (R₁).
//
// Wired to the operator-side handoffs endpoint (tmai-core PR #473) via
// `useHandoffs(unit)`. Renders the unit's baton list in the wire order —
// the active baton first, then archived batons newest-first. Each row is a
// plain select: name, `active`/`archived` marker, `composed_at`, `task`
// (when present). A row click opens the baton in the R₂ viewer column
// (`RHandoverViewer`), mirroring `RPrsSection` / `RIssuesSection`'s
// `onSelect*` / `selectedKey` / `aria-current` posture exactly. R₁ stays a
// pure inventory; the row is just a select.
//
// Honest-degradation (`doc/decisions/2026-05-14-webui-simulated-onboarded-
// posture.md`): the `unit === null` and empty states say so plainly ("No
// hand-overs.") rather than fabricate a list. All facts plain — no severity
// accents (`doc/decisions/2026-05-26-tmai-states-facts-not-appraisals.md`).

import { useHandoffs } from "@/hooks/useHandoffs";
import type { HandoffEntryWire } from "@/lib/api";
import { type SelectedHandoff, selectedHandoffKey } from "./r-viewer/RHandoverViewer";
import { Section } from "./Section";

interface RHandoverSectionProps {
  unitName: string | null;
  expanded: boolean;
  onToggle: () => void;
  /** Open a baton in the R₂ viewer column. Optional so the section still
   *  renders standalone (e.g. in isolation tests). */
  onSelectHandoff?: (sel: SelectedHandoff) => void;
  /** `selectedHandoffKey(unit, name)` of the baton currently open in R₂, so
   *  the row marks itself as the one being viewed (a mechanical "open here"
   *  fact, not appraisal). */
  selectedKey?: string | null;
}

export function RHandoverSection({
  unitName,
  expanded,
  onToggle,
  onSelectHandoff,
  selectedKey,
}: RHandoverSectionProps) {
  const { data, loading, error } = useHandoffs(unitName);
  const handoffs = data?.handoffs ?? null;

  return (
    <Section
      id="handover"
      glyph="📜"
      label="Hand-over"
      count={`${handoffs?.length ?? 0}`}
      expanded={expanded}
      onToggle={onToggle}
    >
      <Body
        unitName={unitName}
        items={handoffs}
        loading={loading}
        error={error}
        onSelectHandoff={onSelectHandoff}
        selectedKey={selectedKey ?? null}
      />
    </Section>
  );
}

interface BodyProps {
  unitName: string | null;
  items: HandoffEntryWire[] | null;
  loading: boolean;
  error: Error | null;
  onSelectHandoff?: (sel: SelectedHandoff) => void;
  selectedKey: string | null;
}

function Body({ unitName, items, loading, error, onSelectHandoff, selectedKey }: BodyProps) {
  if (unitName === null) {
    return <p className="text-subtle-foreground">Pick a project to see hand-overs.</p>;
  }
  if (error !== null) {
    return <p className="text-muted-foreground">Failed to load hand-overs: {error.message}</p>;
  }
  if (items === null && loading) {
    return <p className="text-subtle-foreground">Loading…</p>;
  }
  if (items === null || items.length === 0) {
    return <p className="text-subtle-foreground">No hand-overs.</p>;
  }
  return (
    <ul className="space-y-1">
      {items.map((h) => (
        <HandoffRow
          // The baton name is unique within a unit (the sentinel "active"
          // plus per-timestamp archive filenames) — a stable key.
          key={h.name}
          unit={unitName}
          entry={h}
          onSelectHandoff={onSelectHandoff}
          selected={selectedKey === selectedHandoffKey(unitName, h.name)}
        />
      ))}
    </ul>
  );
}

function HandoffRow({
  unit,
  entry,
  onSelectHandoff,
  selected,
}: {
  unit: string;
  entry: HandoffEntryWire;
  onSelectHandoff?: (sel: SelectedHandoff) => void;
  selected: boolean;
}) {
  // The whole row is a button that opens the baton in the R₂ viewer.
  // `aria-current` marks the row whose content is currently open in R₂ (a
  // mechanical "open here" fact, not appraisal).
  return (
    <li className="leading-snug">
      <button
        type="button"
        onClick={() => onSelectHandoff?.({ unit, name: entry.name })}
        aria-current={selected ? "true" : undefined}
        className={`w-full rounded px-1 py-0.5 text-left transition-colors hover:bg-surface-strong/40 ${
          selected ? "bg-surface-strong/40" : ""
        }`}
      >
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="break-all font-mono text-foreground">{entry.name}</span>
          <span className="text-[11px] text-subtle-foreground">{entry.status}</span>
        </span>
        {(entry.composed_at !== null || entry.task !== null) && (
          <div className="text-[11px] text-subtle-foreground">
            {entry.composed_at !== null && <span>composed {entry.composed_at}</span>}
            {entry.composed_at !== null && entry.task !== null && " · "}
            {entry.task !== null && <span>{entry.task}</span>}
          </div>
        )}
      </button>
    </li>
  );
}
