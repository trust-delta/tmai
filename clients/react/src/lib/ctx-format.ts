// Context-window readout formatting helpers for the aim-console session head
// (`Shead`, Producer variant). Extracted from the retired producer-console
// `ProducerCtxHeader` when the aim console became the sole seat — the three
// pure helpers are all that survived; the header component itself was ripped.

// CC's statusline reports `total` and `used` as bigints (200_000-ish);
// `Nk` rounding keeps the row scannable. `Math.round` on bigint→number
// is safe here — context-window totals fit in `Number.MAX_SAFE_INTEGER`
// by orders of magnitude.
export function formatThousands(n: bigint): string {
  const k = Math.round(Number(n) / 1000);
  return `${k}k`;
}

// 10-segment bar where `pct=71` → 7 filled (▮) + 3 empty (░).
// `Math.round` chosen over `floor` so 65% reads as 7 segments and 64%
// reads as 6 — operator's eye expects "more than half" of the bar to
// flip near the visual midpoint.
export function renderBar(pct: number): { filled: number; empty: number; chars: string } {
  const clamped = Math.max(0, Math.min(100, pct));
  const filled = Math.max(0, Math.min(10, Math.round(clamped / 10)));
  const empty = 10 - filled;
  return {
    filled,
    empty,
    chars: "▮".repeat(filled) + "░".repeat(empty),
  };
}

// Threshold readout colour bands:
//   pct >= threshold        → red    (will trigger / has triggered)
//   threshold - 10 ≤ pct    → amber  ("within 10% of threshold")
//   else                    → zinc
// Threshold == 0 means auto-handoff is disabled — never colour the
// readout in that mode; the row instead labels it "disabled".
export function thresholdColorClass(pct: number | null, threshold: number): string {
  if (threshold <= 0) return "text-muted-foreground";
  if (pct === null) return "text-muted-foreground";
  if (pct >= threshold) return "text-destructive";
  if (pct >= threshold - 10) return "text-warning";
  return "text-muted-foreground";
}
