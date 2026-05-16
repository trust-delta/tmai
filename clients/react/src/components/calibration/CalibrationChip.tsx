// Top-bar always-on calibration indicator.
//
// Surfaces the **most-urgent** signal from the unit's calibration store
// in one chip:
//
// - tripwire ≥ 1 → red ⚡ N — DR §B.4 zero-tolerance alarm, must catch
//   the operator's eye
// - else, store has any entries → muted "✓" with the in-window count
// - else, store empty → no chip rendered at all
//
// The chip is purely a "click-here-for-details" hook into
// [`CalibrationPanel`]; the surface is intentionally narrow.
// Per DR §B.4 we do NOT gate on `len(tripwire) > N` — any non-empty
// list is the alarm.

import type { CalibrationResponse } from "@/lib/api";

interface CalibrationChipProps {
  data: CalibrationResponse | null;
  onClick: () => void;
}

export function CalibrationChip({ data, onClick }: CalibrationChipProps) {
  if (!data) {
    return null;
  }
  const tripwire = data.tier1_violations.length;
  // Per DR §B.4 (zero tolerance): non-empty list IS the alarm.
  if (tripwire > 0) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="glow-red rounded-full bg-destructive/20 px-2.5 py-0.5 text-[11px] font-semibold text-destructive hover:bg-destructive/30 transition-colors"
        title={`${tripwire} tier-1 tripwire violation(s) — DR §B.4 zero tolerance`}
      >
        ⚡ {tripwire}
      </button>
    );
  }
  // Quiet — only render when the store actually has entries; an empty
  // store would be noise.
  if (data.total_in_store === 0) {
    return null;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full bg-surface-strong/50 px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-surface-strong/80 hover:text-foreground transition-colors"
      title={`${data.total_in_window}/${data.total_in_store} calibration entries — click for details`}
    >
      cal {data.total_in_window}
    </button>
  );
}
