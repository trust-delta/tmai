// Top-of-body banner that hoists the tier-1 tripwire callout (DR §B.4
// `⚡ TIER-1 TRIPWIRE TRIGGERED`) into the WebUI for operators who
// watch the browser, not their terminal.
//
// Mirrors what `tmai producer <unit>`'s hand-over digest shows at
// session start — but persistently, so a violation cannot be missed by
// timing the next Producer launch. Renders nothing when the violation
// list is empty (DR §B.4 explicitly: non-empty list IS the alarm; do
// not gate on a count threshold).

import type { CalibrationResponse } from "@/lib/api";

interface TripwireBannerProps {
  data: CalibrationResponse | null;
  onDetailsClick?: () => void;
}

export function TripwireBanner({ data, onDetailsClick }: TripwireBannerProps) {
  if (!data || data.tier1_violations.length === 0) {
    return null;
  }
  const violations = data.tier1_violations;
  return (
    <div className="border-b border-red-500/40 bg-red-950/40 px-4 py-2.5">
      <div className="flex items-start gap-3">
        <span className="text-lg leading-none text-red-300">⚡</span>
        <div className="flex-1 text-sm">
          <div className="font-semibold text-red-200">
            TIER-1 TRIPWIRE TRIGGERED{" "}
            <span className="font-normal text-red-300/70">
              ({violations.length} violation{violations.length === 1 ? "" : "s"} on{" "}
              <code className="text-red-200/90">{data.unit}</code>)
            </span>
          </div>
          <p className="mt-1 text-xs text-red-300/80">
            Tier-1 is human-gated only (<code>escalate</code> is the only valid verdict). Each item
            below is a non-<code>escalate</code> verdict routed to tier-1 — review whether the
            tier-1 grade was wrong (tighten the tier-gate) or the Producer&apos;s posture was wrong
            (tighten the posture). DR §B.4: zero tolerance.
          </p>
          <ul className="mt-2 space-y-1 text-xs text-red-200/90">
            {violations.slice(0, 5).map((v) => (
              <li key={`${v.synthesis_pass_id}-${v.note_source}`}>
                <code className="text-red-200">{v.note_source}</code>{" "}
                <span className="text-red-300/70">
                  ({v.verdict}, confidence {v.confidence})
                </span>{" "}
                — {v.rationale}
              </li>
            ))}
            {violations.length > 5 && (
              <li className="text-red-300/60 italic">... and {violations.length - 5} more</li>
            )}
          </ul>
          {onDetailsClick && (
            <button
              type="button"
              onClick={onDetailsClick}
              className="mt-2 text-xs text-red-300/80 underline-offset-2 hover:underline hover:text-red-200"
            >
              Open calibration panel →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
