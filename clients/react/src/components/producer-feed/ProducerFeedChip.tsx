// Top-bar always-on pending-delta indicator.
//
// Surfaces the unit's producer-feed delta-gate in one chip:
//
// - has_pending_delta === true → informational ⚡ 差分 pill — there is
//   something for the Producer to pull; clicking pings it.
// - else (no data, or gate false) → no chip rendered at all
//
// Deliberately NOT the destructive-red alarm styling of CalibrationChip:
// a pending delta is "there's something to pull", not a tier-1 alarm, so
// it uses the informational `primary` accent. The chip shares the single
// `handleTriggerProducerFeed` callback with the action-row button (App
// level) — it is the same idempotent ping from a second surface.
// Quiet-when-nothing mirrors CalibrationChip returning null on an empty
// store: no chip, no noise.

import type { ProducerFeedStatus } from "@/lib/api";

interface ProducerFeedChipProps {
  data: ProducerFeedStatus | null;
  onClick: () => void;
}

export function ProducerFeedChip({ data, onClick }: ProducerFeedChipProps) {
  // `has_pending_delta` is optional/absent on the wire when false (#404
  // lockstep-free bool); anything other than an explicit `true` is quiet.
  if (!data || data.has_pending_delta !== true) {
    return null;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full bg-primary/20 px-2.5 py-0.5 text-[11px] font-semibold text-primary hover:bg-primary/30 transition-colors"
      title="Pending feed deltas — click to have the Producer pull them"
    >
      ⚡ 差分
    </button>
  );
}
