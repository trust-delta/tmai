// Drill-down view of the unit's calibration store — the WebUI mirror
// of `tmai calibration <unit>` (DR `2026-05-13-synthesis-processing-
// and-calibration-schema.md` §B.3).
//
// Layout follows the CLI render exactly so an operator who already
// knows the shape from the terminal reads the same table here:
//
//   header (unit / window / total / bootstrap caveat)
//   (verdict × confidence) × (n / hits / misses / accuracy) table
//   recent false-negatives list (with outcome detail)
//   tier-1 routing counter (✓ or ⚠ block)
//
// The Producer itself is **blind by default** (DR §B.3 first layer);
// this panel is the explicit human escape hatch. Closing it is what
// returns to the blind default.

import { useCalibration } from "@/hooks/useCalibration";
import type { CalibrationCellWire, CalibrationEntry, Outcome } from "@/lib/api";

interface CalibrationPanelProps {
  unit: string;
  onClose: () => void;
}

export function CalibrationPanel({ unit, onClose }: CalibrationPanelProps) {
  const { data, loading, error } = useCalibration(unit, 90);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b border-hairline px-6 py-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Calibration</h2>
          <p className="text-xs text-muted-foreground">
            Unit: <code className="text-foreground">{unit}</code> · DR §B.3 read-only window into
            Producer hit-rate
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-3 py-1 text-sm text-muted-foreground transition-colors hover:bg-surface-strong hover:text-foreground"
        >
          Close
        </button>
      </header>

      <div className="flex-1 space-y-6 overflow-y-auto px-6 py-4 text-sm">
        {loading && !data && <p className="text-muted-foreground">Loading…</p>}
        {error && !data && (
          <p className="text-destructive">
            Failed to load calibration: <code>{error.message}</code>
          </p>
        )}
        {data && <CalibrationContent data={data} />}
      </div>
    </div>
  );
}

function CalibrationContent({
  data,
}: {
  data: NonNullable<ReturnType<typeof useCalibration>["data"]>;
}) {
  const empty = data.total_in_store === 0;
  const shallow = !empty && data.total_in_store < data.bootstrap_threshold;
  return (
    <>
      <section className="rounded-md border border-hairline bg-surface px-4 py-3">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">Window</p>
        <p className="mt-1 text-foreground">
          {data.days === 0 ? "Whole store" : `Last ${data.days} days`}{" "}
          <span className="text-muted-foreground">
            ({data.total_in_window} entries; {data.total_in_store} in store)
          </span>
        </p>
        {empty && (
          <p className="mt-2 text-xs text-muted-foreground">
            Store is empty. The Producer has not recorded any triage verdicts for this unit yet —
            run <code>tmai producer {data.unit} --synthesize</code> to start one.
          </p>
        )}
        {shallow && (
          <p className="mt-2 text-xs text-warning/80">
            Only {data.total_in_store} entries in the store (&lt; {data.bootstrap_threshold}{" "}
            bootstrap threshold). Numbers below carry low confidence; lean toward asking the human,
            not these stats. (DR §B.5)
          </p>
        )}
      </section>

      <CellTable cells={data.cells} />

      <FalseNegativesList entries={data.recent_false_negatives} />

      <Tier1Counter routed={data.tier1_routed} violations={data.tier1_violations} />
    </>
  );
}

function CellTable({ cells }: { cells: CalibrationCellWire[] }) {
  if (cells.length === 0) {
    return (
      <section>
        <h3 className="text-xs uppercase tracking-wider text-muted-foreground">Verdicts</h3>
        <p className="mt-2 text-muted-foreground">(no entries in this window)</p>
      </section>
    );
  }
  return (
    <section>
      <h3 className="text-xs uppercase tracking-wider text-muted-foreground">Verdicts</h3>
      <table className="mt-2 w-full text-left">
        <thead className="text-[11px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-2 py-1 font-medium">Verdict</th>
            <th className="px-2 py-1 font-medium">Confidence</th>
            <th className="px-2 py-1 text-right font-medium">n</th>
            <th className="px-2 py-1 text-right font-medium">hits</th>
            <th className="px-2 py-1 text-right font-medium">misses</th>
            <th className="px-2 py-1 text-right font-medium">accuracy</th>
          </tr>
        </thead>
        <tbody className="text-foreground">
          {cells.map((c) => {
            const accuracy = c.n === 0 ? null : (c.hits / c.n) * 100;
            const smallN = c.n < 5;
            return (
              <tr key={`${c.verdict}-${c.confidence}`} className="border-t border-hairline">
                <td className="px-2 py-1 font-mono text-xs">{c.verdict}</td>
                <td className="px-2 py-1 font-mono text-xs">{c.confidence}</td>
                <td className="px-2 py-1 text-right tabular-nums">{c.n}</td>
                <td className="px-2 py-1 text-right tabular-nums text-success/90">{c.hits}</td>
                <td className="px-2 py-1 text-right tabular-nums text-destructive/90">
                  {c.misses}
                </td>
                <td className="px-2 py-1 text-right tabular-nums">
                  {accuracy === null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <>
                      {accuracy.toFixed(1)}%
                      {smallN && (
                        <span className="ml-1 text-[10px] text-muted-foreground">(small n)</span>
                      )}
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function FalseNegativesList({ entries }: { entries: CalibrationEntry[] }) {
  if (entries.length === 0) {
    return (
      <section>
        <h3 className="text-xs uppercase tracking-wider text-muted-foreground">
          False-negative recents
        </h3>
        <p className="mt-2 text-muted-foreground">none</p>
      </section>
    );
  }
  return (
    <section>
      <h3 className="text-xs uppercase tracking-wider text-muted-foreground">
        False-negative recents (newest first)
      </h3>
      <ul className="mt-2 space-y-1 text-xs text-foreground">
        {entries.slice(0, 10).map((e) => (
          <li key={`${e.synthesis_pass_id}-${e.note_source}`}>
            <span className="text-muted-foreground">{e.recorded_at.slice(0, 10)}</span>{" "}
            <code className="text-foreground">{e.verdict}</code>{" "}
            <span className="text-muted-foreground">
              {e.confidence} (tier {e.tier_routed})
            </span>{" "}
            &ldquo;<code className="text-foreground">{e.note_source}</code>&rdquo;:{" "}
            {e.outcome ? <OutcomeSummary outcome={e.outcome} /> : <span>?</span>}
          </li>
        ))}
        {entries.length > 10 && (
          <li className="text-muted-foreground italic">... and {entries.length - 10} more</li>
        )}
      </ul>
    </section>
  );
}

function OutcomeSummary({ outcome }: { outcome: Outcome }) {
  // Tagged enum — the wire shape is `{ kind: "...", ... }`. Render
  // each variant inline; this is intentionally identical in spirit
  // to the CLI's `outcome_summary` so the operator reads the same
  // string in both surfaces.
  switch (outcome.kind) {
    case "revert_commit":
      return (
        <span>
          revert <code>{outcome.commit_sha}</code> on {outcome.date}
        </span>
      );
    case "hotfix_commit":
      return (
        <span>
          hotfix <code>{outcome.commit_sha}</code> on {outcome.date}
        </span>
      );
    case "ci_fail_fix":
      return (
        <span>
          ci-fail PR #{outcome.failing_pr} → fix PR #{outcome.fix_pr}
        </span>
      );
  }
}

function Tier1Counter({ routed, violations }: { routed: number; violations: CalibrationEntry[] }) {
  const clean = violations.length === 0;
  return (
    <section
      className={
        clean
          ? "rounded-md border border-hairline bg-surface px-4 py-3"
          : "rounded-md border border-destructive/40 bg-destructive/30 px-4 py-3"
      }
    >
      <p className="text-xs uppercase tracking-wider text-muted-foreground">Tier-1 routings</p>
      <p className="mt-1 text-foreground">
        {routed} (violations: {violations.length}{" "}
        {clean ? (
          <span className="text-success">✓</span>
        ) : (
          <span className="text-destructive">⚠</span>
        )}
        )
      </p>
      {!clean && (
        <p className="mt-2 text-xs text-destructive/80">
          Tier-1 violations are zero-tolerance (DR §B.4). Each non-
          <code>escalate</code> verdict routed to tier-1 is either a tier-gate bug or a Producer
          posture failure — review the entries above and decide whether to tighten the gate or the
          posture.
        </p>
      )}
    </section>
  );
}
