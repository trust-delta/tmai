// Remote-Δ unobserved-row accent (#822) — the small leading Δ glyph on a
// PR / issue row whose vocab timestamp is newer than the operator's
// close-act cursor (see remote-delta.ts).
//
// Info-tone (the cyan-family `info` token), NEVER the warning/owed amber:
// "unobserved" is a neutral freshness FACT ("changed since you last
// looked / 見ていた"), not an appraisal and not a debt. Observed rows
// render with no counterpart element at all — observed is the unmarked
// default state, not a second badge.
export function UnobservedDelta() {
  return (
    <span
      data-testid="unobserved-delta"
      title="unobserved — changed since you last looked"
      className="mr-1 font-mono text-info"
    >
      Δ
    </span>
  );
}
