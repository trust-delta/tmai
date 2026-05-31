// 📊 Calibration — R panel's raw calibration inventory (R₁).
//
// Reuses `useCalibration(unit)` (App.tsx already polls it for the
// top-bar chip + tripwire banner — but the hook is poll-and-cache
// at the hook layer, so reading it again here is fine; the polling
// is per-unit per-hook-instance). Entries date desc, plain text,
// no severity coloring.
//
// Unlike the PR / issue / decision sections (a unit has MANY of each, so
// each row is a select), a unit has exactly ONE calibration — so the open
// affordance is a single "View calibration detail ›" button on the body
// (not a per-row select). It focuses the R₂ `RCalibrationViewer` via
// `onSelectCalibration({ unit })`, mirroring the other sections'
// `onSelect*` / `selectedKey` / `aria-current` posture. R₁ stays a pure
// inventory; the button is just a focus.

import { useCalibration } from "@/hooks/useCalibration";
import type { CalibrationEntry, CalibrationResponse } from "@/lib/api";
import { type SelectedCalibration, selectedCalibrationKey } from "./r-viewer/RCalibrationViewer";
import { Section } from "./Section";

interface RCalibrationSectionProps {
  unitName: string | null;
  expanded: boolean;
  onToggle: () => void;
  /** Open the unit's calibration in the R₂ viewer column. Optional so the
   *  section still renders standalone (e.g. in isolation tests). */
  onSelectCalibration?: (sel: SelectedCalibration) => void;
  /** `selectedCalibrationKey(unit)` of the calibration currently open in
   *  R₂, so the detail affordance marks itself as the one being viewed (a
   *  mechanical "open here" fact, not appraisal). */
  selectedKey?: string | null;
}

export function RCalibrationSection({
  unitName,
  expanded,
  onToggle,
  onSelectCalibration,
  selectedKey,
}: RCalibrationSectionProps) {
  const { data, loading, error } = useCalibration(unitName);
  const total = data?.total_in_window ?? 0;

  return (
    <Section
      id="calibration"
      glyph="📊"
      label="Calibration"
      count={`${total}`}
      expanded={expanded}
      onToggle={onToggle}
    >
      <Body
        unitName={unitName}
        data={data}
        loading={loading}
        error={error}
        onSelectCalibration={onSelectCalibration}
        selectedKey={selectedKey ?? null}
      />
    </Section>
  );
}

interface BodyProps {
  unitName: string | null;
  data: CalibrationResponse | null;
  loading: boolean;
  error: Error | null;
  onSelectCalibration?: (sel: SelectedCalibration) => void;
  selectedKey: string | null;
}

function Body({ unitName, data, loading, error, onSelectCalibration, selectedKey }: BodyProps) {
  if (unitName === null) {
    return <p className="text-subtle-foreground">Pick a project to see calibration.</p>;
  }
  if (error !== null) {
    return <p className="text-muted-foreground">Failed to load calibration: {error.message}</p>;
  }
  if (data === null && loading) {
    return <p className="text-subtle-foreground">Loading…</p>;
  }
  if (data === null) {
    return <p className="text-subtle-foreground">No calibration data.</p>;
  }
  const entries = [...data.tier1_violations, ...data.recent_false_negatives];
  entries.sort((a, b) => b.recorded_at.localeCompare(a.recorded_at));
  const detail = (
    <DetailAffordance
      unit={unitName}
      onSelectCalibration={onSelectCalibration}
      selected={selectedKey === selectedCalibrationKey(unitName)}
    />
  );
  if (entries.length === 0) {
    return (
      <div className="space-y-1">
        <p className="text-subtle-foreground">
          {data.total_in_window} entries in last {data.days} days; no tripwires or false-negatives.
        </p>
        {detail}
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <ul className="space-y-1">
        {entries.map((e, idx) => (
          // `CalibrationEntry` has no id field; `(recorded_at, note_source)`
          // can collide when one synthesis-pass routes multiple verdicts
          // off the same note. Compose with idx to disambiguate. Safe
          // here because `entries` is rebuilt on every render from a
          // stable sort, and the rows are leaf, stateless presentational
          // <li>s — there is no per-row state that the index reshuffle
          // could orphan.
          // biome-ignore lint/suspicious/noArrayIndexKey: index is the disambiguator on top of a composite natural key, not the sole key — see comment above.
          <EntryRow key={`${e.recorded_at}-${e.note_source}-${idx}`} entry={e} />
        ))}
      </ul>
      {detail}
    </div>
  );
}

// The single "open the R₂ calibration detail" affordance. A unit has ONE
// calibration, so this is a section-level button, not a per-row select.
// `aria-current` marks it when the unit's calibration is the one open in
// R₂ (a mechanical "open here" fact, not appraisal). Plain styling only.
function DetailAffordance({
  unit,
  onSelectCalibration,
  selected,
}: {
  unit: string;
  onSelectCalibration?: (sel: SelectedCalibration) => void;
  selected: boolean;
}) {
  if (!onSelectCalibration) return null;
  return (
    <button
      type="button"
      onClick={() => onSelectCalibration({ unit })}
      aria-current={selected ? "true" : undefined}
      className={`w-full rounded px-1 py-0.5 text-left text-[11px] text-muted-foreground transition-colors hover:bg-surface-strong/40 hover:text-foreground ${
        selected ? "bg-surface-strong/40 text-foreground" : ""
      }`}
    >
      View calibration detail ›
    </button>
  );
}

function EntryRow({ entry }: { entry: CalibrationEntry }) {
  return (
    <li className="leading-snug">
      <span className="font-mono text-subtle-foreground">{entry.recorded_at}</span>{" "}
      <span className="text-foreground">{entry.note_source}</span>
      <div className="text-[11px] text-subtle-foreground">
        verdict {entry.verdict} · confidence {entry.confidence} · tier {entry.tier_routed}
      </div>
    </li>
  );
}
