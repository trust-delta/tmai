// 📊 Calibration — R panel's raw calibration inventory.
//
// Reuses `useCalibration(unit)` (App.tsx already polls it for the
// top-bar chip + tripwire banner — but the hook is poll-and-cache
// at the hook layer, so reading it again here is fine; the polling
// is per-unit per-hook-instance). Entries date desc, plain text,
// no severity coloring.

import { useCalibration } from "@/hooks/useCalibration";
import type { CalibrationEntry, CalibrationResponse } from "@/lib/api";
import { Section } from "./Section";

interface RCalibrationSectionProps {
  unitName: string | null;
  expanded: boolean;
  onToggle: () => void;
}

export function RCalibrationSection({ unitName, expanded, onToggle }: RCalibrationSectionProps) {
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
      <Body unitName={unitName} data={data} loading={loading} error={error} />
    </Section>
  );
}

interface BodyProps {
  unitName: string | null;
  data: CalibrationResponse | null;
  loading: boolean;
  error: Error | null;
}

function Body({ unitName, data, loading, error }: BodyProps) {
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
  if (entries.length === 0) {
    return (
      <p className="text-subtle-foreground">
        {data.total_in_window} entries in last {data.days} days; no tripwires or false-negatives.
      </p>
    );
  }
  return (
    <ul className="space-y-1">
      {entries.map((e) => (
        <EntryRow key={`${e.recorded_at}-${e.note_source}`} entry={e} />
      ))}
    </ul>
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
