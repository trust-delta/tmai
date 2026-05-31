// R₂ — the in-tmai Calibration overview viewer (per-unit, read-only).
// Serves the spine `2026-05-29-c-and-r-as-the-development-substrate` (the
// per-kind walk's "📊 Calibration" surface) + `2026-05-29-artifact-content-
// viewer` (γ-lean R₂ viewer).
//
// Mirrors `RPrViewer` / `RRecordViewer` / `RIssueViewer` posture exactly:
// in focus mode it RIDES the R panel's single column IN PLACE OF the R₁
// inventory — same drag-set width, never an additive column. It NEVER
// auto-opens — it mounts only on an explicit operator click in the R₁
// inventory (the parent gates the mount on a non-null `selectedCalibration`).
// R₁ (`RCalibrationSection`) stays a pure inventory; this viewer renders
// the unit's full calibration overview.
//
// Calibration is a META-ARTIFACT: it is how the OPERATOR judges the
// Producer's triage hit-rate. Unlike PR / decision / issue (a unit has
// MANY of each), a unit has exactly ONE calibration — so there is no row
// to select, just a "view the detail" affordance, and `SelectedCalibration`
// carries only the unit name. The viewer re-fetches via `useCalibration`
// (cheap — App already polls the same per-unit cache for the top-bar chip
// + tripwire banner) and renders the read-only overview off that one
// response.
//
// SCOPE — read-only, NO actions. The (iii) acts (tier-1 acknowledge, a
// `[→Producer brief]` button) need endpoints that do NOT exist server-side
// and are explicitly deferred — the viewer mutates nothing.
//
// Negative space (the serving `2026-05-26-tmai-states-facts-not-appraisals`
// posture — ESPECIALLY load-bearing here: a judge-of-the-Producer surface
// must not pre-judge for the operator):
//   - ALL facts stay PLAIN — `text-foreground` / `text-muted-foreground` /
//     `text-subtle-foreground` only, never warning / destructive / success
//     accents. This INCLUDES tier-1 violations (a plain `(tier-1)` suffix,
//     never a red alarm) and hit/miss outcomes (a rate is stated, not
//     appraised);
//   - the window aggregation is a PLAIN table of mechanical rates / counts.
//     A chart was deliberately skipped (the table is the must, the chart is
//     skippable) — it would risk severity coloring / "good-bad" framing on
//     the operator's own judging surface, and it adds nothing the table
//     does not already state;
//   - NO "changed since you last looked" / unread / TL;DR / auto-summary —
//     only what the wire carries is rendered.

import { useCalibration } from "@/hooks/useCalibration";
import type {
  CalibrationCellWire,
  CalibrationEntry,
  CalibrationResponse,
  Outcome,
} from "@/lib/api";
import { InventoryBackButton } from "./InventoryBackButton";

// What R₁ hands R₂ on a "view calibration detail" click. A unit has ONE
// calibration, so the selection carries only the unit name — there is no
// per-row identity (the asymmetry with `SelectedPr` / `SelectedIssue`,
// which carry a full ride-along item, is intentional: there is nothing to
// ride along, the whole overview re-fetches off the unit).
export interface SelectedCalibration {
  unit: string;
}

// Symmetry helper with `selectedPrKey` / `selectedRecordKey` /
// `selectedIssueKey`: the unit name IS the focus key (one calibration per
// unit), so the R₁ affordance marks itself when this equals its unit.
export function selectedCalibrationKey(unit: string): string {
  return unit;
}

interface RCalibrationViewerProps {
  selected: SelectedCalibration;
  onClose: () => void;
}

export function RCalibrationViewer({ selected, onClose }: RCalibrationViewerProps) {
  const { data, loading, error } = useCalibration(selected.unit);

  // Focus mode: fills the R panel's single column (`flex-1`) at the
  // operator's drag-set width — imposes no width of its own, so it never
  // squeezes the centre conversation.
  return (
    <div data-testid="r-calibration-viewer" className="flex min-h-0 flex-1 flex-col">
      <ViewerHeader unit={selected.unit} data={data} onClose={onClose} />
      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3 text-xs">
        {loading && <Loading />}
        {error && <FetchError what="calibration" message={error.message} />}
        {data !== null && (
          <>
            <CellsSection cells={data.cells} />
            <EntriesSection title="Tier-1 violations" entries={data.tier1_violations} tierOne />
            <EntriesSection title="Recent false-negatives" entries={data.recent_false_negatives} />
          </>
        )}
      </div>
    </div>
  );
}

// ── Header — mechanical window facts, all plain (no severity tint) ──
//
// Identity (unit · calibration) renders immediately; the window facts
// (days / totals / tier-1 routed) and the bootstrap caveat appear once the
// fetch resolves. The caveat states a plain fact about sample size — "lean
// toward asking the human" — not a verdict on the Producer.

function ViewerHeader({
  unit,
  data,
  onClose,
}: {
  unit: string;
  data: CalibrationResponse | null;
  onClose: () => void;
}) {
  return (
    <header className="shrink-0 border-b border-hairline px-4 py-3">
      <InventoryBackButton onClose={onClose} />
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wide text-subtle-foreground">
          {unit} · calibration
        </p>
      </div>
      {data !== null && (
        <>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-subtle-foreground">
            <span className="text-muted-foreground">last {data.days} days</span>
            <span className="text-muted-foreground">{data.total_in_window} in window</span>
            <span className="text-muted-foreground">{data.total_in_store} in store</span>
            <span className="text-muted-foreground">{data.tier1_routed} tier-1 routed</span>
          </div>
          {data.total_in_window < data.bootstrap_threshold && (
            <p className="mt-1 text-[11px] text-subtle-foreground">
              Below the bootstrap threshold ({data.total_in_window} &lt; {data.bootstrap_threshold})
              — lean toward asking the human.
            </p>
          )}
        </>
      )}
    </header>
  );
}

// ── Section frame + async states (plain, never a fabricated empty) ──
//
// Ported 1:1 from the sibling R₂ viewers so the four read identically.

function SectionFrame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-subtle-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Loading() {
  return <p className="text-subtle-foreground">Loading…</p>;
}

function FetchError({ what, message }: { what: string; message: string }) {
  return (
    <p className="text-muted-foreground">
      Failed to load {what}: {message}
    </p>
  );
}

// ── Window aggregation — plain table of mechanical rates / counts ──
//
// The `cells` list is the workbench's `(verdict, confidence)` aggregation
// flattened for JSON. Rendered as a plain numeric table: hit-rate is a
// stated quotient (`hits / n`), NOT a colored gauge — it states the rate,
// it does not appraise it.

function formatRate(hits: number, n: number): string {
  if (n === 0) return "—";
  return `${Math.round((hits / n) * 100)}%`;
}

function CellsSection({ cells }: { cells: CalibrationCellWire[] }) {
  return (
    <SectionFrame title="Window aggregation">
      {cells.length === 0 ? (
        <p className="text-subtle-foreground">No aggregation cells.</p>
      ) : (
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="text-left text-subtle-foreground">
              <th className="py-1 pr-3 font-medium">verdict</th>
              <th className="py-1 pr-3 font-medium">confidence</th>
              <th className="py-1 pr-3 text-right font-medium">n</th>
              <th className="py-1 pr-3 text-right font-medium">hits</th>
              <th className="py-1 pr-3 text-right font-medium">misses</th>
              <th className="py-1 text-right font-medium">hit-rate</th>
            </tr>
          </thead>
          <tbody>
            {cells.map((c) => (
              // `(verdict, confidence)` is the natural unique key — the wire
              // is a flattened map, so the pair never repeats.
              <tr
                key={`${c.verdict}-${c.confidence}`}
                className="border-t border-hairline-strong/30 text-foreground"
              >
                <td className="py-1 pr-3">{c.verdict}</td>
                <td className="py-1 pr-3">{c.confidence}</td>
                <td className="py-1 pr-3 text-right font-mono">{c.n}</td>
                <td className="py-1 pr-3 text-right font-mono">{c.hits}</td>
                <td className="py-1 pr-3 text-right font-mono">{c.misses}</td>
                <td className="py-1 text-right font-mono">{formatRate(c.hits, c.n)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </SectionFrame>
  );
}

// ── Calibration entries (tier-1 violations + false-negatives) ──
//
// Each entry renders full detail. Tier-1 violations carry a PLAIN
// `(tier-1)` suffix — a routing fact, never a red alarm. The outcome (if
// the world has produced one) is stated plainly; a fresh entry says so.

function EntriesSection({
  title,
  entries,
  tierOne,
}: {
  title: string;
  entries: CalibrationEntry[];
  tierOne?: boolean;
}) {
  return (
    <SectionFrame title={`${title} (${entries.length})`}>
      {entries.length === 0 ? (
        <p className="text-subtle-foreground">None.</p>
      ) : (
        <ul className="space-y-2">
          {entries.map((e, idx) => (
            <EntryItem
              // `CalibrationEntry` has no id field; `(recorded_at, note_source)`
              // can collide when one synthesis pass routes multiple verdicts
              // off the same note. Compose with idx to disambiguate — safe on
              // these leaf, stateless presentational <li>s (mirrors
              // `RCalibrationSection`'s key).
              // biome-ignore lint/suspicious/noArrayIndexKey: index disambiguates a composite natural key, not the sole key.
              key={`${e.recorded_at}-${e.note_source}-${idx}`}
              entry={e}
              tierOne={tierOne}
            />
          ))}
        </ul>
      )}
    </SectionFrame>
  );
}

function EntryItem({ entry, tierOne }: { entry: CalibrationEntry; tierOne?: boolean }) {
  return (
    <li className="rounded border border-hairline-strong/40 bg-surface-strong/20 px-2 py-1.5">
      <div className="flex flex-wrap items-baseline gap-x-2 text-[11px]">
        <span className="font-mono text-subtle-foreground">{entry.recorded_at}</span>
        <span className="text-foreground">{entry.note_source}</span>
        {tierOne && <span className="text-subtle-foreground">(tier-1)</span>}
      </div>
      <div className="mt-1 text-[11px] text-subtle-foreground">
        verdict {entry.verdict} · confidence {entry.confidence} · tier {entry.tier_routed}
      </div>
      <p className="mt-1 text-muted-foreground">{entry.rationale}</p>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 text-[11px] text-subtle-foreground">
        <span>outcome {outcomeLabel(entry.outcome ?? null)}</span>
        <span className="font-mono">pass {entry.synthesis_pass_id}</span>
      </div>
    </li>
  );
}

// The objective outcome is a discriminated union (or absent). Rendered as a
// plain factual string — no hit/miss coloring, no "good/bad" framing.
function outcomeLabel(outcome: Outcome | null): string {
  if (outcome === null) return "none observed yet";
  switch (outcome.kind) {
    case "revert_commit":
      return `revert ${outcome.commit_sha} (${outcome.date})`;
    case "hotfix_commit":
      return `hotfix ${outcome.commit_sha} (${outcome.date})`;
    case "ci_fail_fix":
      return `ci-fail-fix PR #${outcome.failing_pr} → #${outcome.fix_pr}`;
  }
}
