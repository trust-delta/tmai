// Review-trigger readiness — the ONE re-evaluation cue tmai can auto-detect.
//
// Shared by R₁'s `ApproachRow` (the inline "should I look?" attention
// marker) and R₂'s `ReviewTriggerIndicator` (the per-trigger annotation),
// so the date logic lives in exactly one place. A `date`-kind trigger is
// "ready" when its date is on or before today; the other trigger kinds
// (pr-closed / pr-merged / issue-closed / *-status / manual) can't be
// auto-detected and are never "ready" by this check.
//
// Posture (`2026-05-26-tmai-states-facts-not-appraisals`): readiness is a
// plain fact surfaced for scanning, not an alarm — callers render it in
// plain/muted colours only.

import type { ApproachWire, ReviewTriggerWire } from "@/lib/api";

// `YYYY-MM-DD` for today. The UTC day boundary is immaterial for this
// plain fact, and ISO date strings compare correctly lexicographically,
// so a string `<=` is a valid "on or before today".
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// A single date-kind trigger is ready when its date is on or before today.
export function isDateTriggerReady(
  trigger: ReviewTriggerWire,
  today: string = todayIso(),
): boolean {
  return trigger.kind === "date" && trigger.value <= today;
}

// An approach is review-trigger-ready when ANY of its date triggers is on
// or before today.
export function isReviewTriggerReady(approach: ApproachWire, today: string = todayIso()): boolean {
  return approach.review_triggers.some((t) => isDateTriggerReady(t, today));
}
