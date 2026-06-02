// 📦 In-play — R panel's cross-record in-play inventory (R₁).
//
// The operator's "what's in-play / what's outstanding" view, fed by
// `useUnitInventory` → `api.unitInventory` (the projection wire from
// tmai-core #485/#486). Each decision is a row (`display`,
// `frontmatter_status`, `serving_health`, `running_count`) with its serving
// approaches nested under it, then a trailing unanchored-approaches
// subsection. Each approach row carries its fact-projected status, its
// work-residual (count + the outstanding ids), and its liveness (stalled +
// last fact).
//
// R₁ is a lens, not a dashboard (the serving
// `2026-05-26-tmai-states-facts-not-appraisals` posture): the inventory is
// light, plain-text, mechanical fact (count / state / date). NO severity
// coloring, NO appraisal form — `stalled` / `overflow` / `orphaned` /
// residual-count render as plain neutral labels
// (`text-foreground` / `text-muted-foreground` / `text-subtle-foreground`
// only), never warning / destructive / success accents. The data is
// mechanical; the operator judges. This mirrors the restraint of the other
// R-panel sections.
//
// A row click opens the record in the R₂ `RRecordViewer`, reusing the same
// R₁⇄R₂ focus-mode the Decisions / Approaches sections use. The inventory
// projection carries only `slug` + `display`, so the section also reads the
// unit's decisions + approaches (the cheap 60s polls R₁ already uses) and
// resolves each entry's slug through `buildRecordIndex` to the full record
// (with its `repoPath` / `repoLabel`) the viewer needs. A slug that has not
// resolved yet renders plain and inert — not an error.

import { useMemo } from "react";
import { useApproaches } from "@/hooks/useApproaches";
import { useDecisions } from "@/hooks/useDecisions";
import { useUnitInventory } from "@/hooks/useUnitInventory";
import type {
  ApproachInventoryWire,
  DecisionInventoryWire,
  UnitInventoryResponse,
} from "@/lib/api";
import { type SelectedRecord, selectedRecordKey } from "./r-viewer/RRecordViewer";
import { buildRecordIndex } from "./r-viewer/record-index";
import { Section } from "./Section";

interface RInventorySectionProps {
  unitName: string | null;
  expanded: boolean;
  onToggle: () => void;
  /** Open a decision/approach in the R₂ record viewer column (mirrors
   *  `RApproachesSection.onSelect`). Optional so the section still renders
   *  standalone in isolation. */
  onSelect?: (sel: SelectedRecord) => void;
  /** `selectedRecordKey(repoPath, slug)` of the record currently open in
   *  R₂, so the row marks itself as the one being viewed. */
  selectedKey?: string | null;
}

export function RInventorySection({
  unitName,
  expanded,
  onToggle,
  onSelect,
  selectedKey,
}: RInventorySectionProps) {
  const { data, loading, error } = useUnitInventory(unitName);
  // The inventory projection carries only slug/display; resolve each
  // entry's slug to the full record (with repoPath/repoLabel) so a row
  // click can open R₂'s RRecordViewer — the same index RRecordViewer uses
  // for its own cross-refs.
  const { data: decisions } = useDecisions(unitName);
  const { data: approaches } = useApproaches(unitName);
  const index = useMemo(() => buildRecordIndex(decisions, approaches), [decisions, approaches]);

  // Counts are the wire's own (mechanical fact), rendered plain by Section.
  const count =
    data === null ? "" : `${data.decision_count} decisions · ${data.approach_count} approaches`;

  return (
    <Section
      id="inventory"
      glyph="📦"
      label="In-play"
      count={count}
      expanded={expanded}
      onToggle={onToggle}
    >
      <Body
        unitName={unitName}
        data={data}
        loading={loading}
        error={error}
        index={index}
        onSelect={onSelect}
        selectedKey={selectedKey ?? null}
      />
    </Section>
  );
}

interface BodyProps {
  unitName: string | null;
  data: UnitInventoryResponse | null;
  loading: boolean;
  error: Error | null;
  index: Map<string, SelectedRecord>;
  onSelect?: (sel: SelectedRecord) => void;
  selectedKey: string | null;
}

function Body({ unitName, data, loading, error, index, onSelect, selectedKey }: BodyProps) {
  if (unitName === null) {
    return <p className="text-subtle-foreground">Pick a project to see the in-play inventory.</p>;
  }
  if (error !== null) {
    return <p className="text-muted-foreground">Failed to load inventory: {error.message}</p>;
  }
  if (data === null && loading) {
    return <p className="text-subtle-foreground">Loading…</p>;
  }
  if (data === null || (data.decisions.length === 0 && data.unanchored_approaches.length === 0)) {
    return <p className="text-subtle-foreground">No in-play records.</p>;
  }
  return (
    <div className="space-y-2">
      {/* The ISO date liveness was computed against — a plain "as of" so the
          stalled / last-fact facts read against a known reference, not a
          guessed client clock. */}
      <p className="text-[11px] text-subtle-foreground">as of {data.today}</p>
      {data.decisions.map((decision) => (
        <DecisionBlock
          key={decision.slug}
          decision={decision}
          index={index}
          onSelect={onSelect}
          selectedKey={selectedKey}
        />
      ))}
      {data.unanchored_approaches.length > 0 && (
        <div data-testid="r-inventory-unanchored">
          <p className="text-[11px] uppercase tracking-wide text-subtle-foreground">
            Unanchored approaches
          </p>
          <ul className="space-y-0.5">
            {data.unanchored_approaches.map((approach) => (
              <ApproachRow
                key={approach.slug}
                approach={approach}
                index={index}
                onSelect={onSelect}
                selectedKey={selectedKey}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// A decision row (its mechanical projection facts) with its serving
// approaches nested under it. The whole row is a button that opens the
// decision in R₂ — `aria-current` marks the row whose content is open
// there. `serving_health` (`orphaned` / `no-running-means` / `healthy` /
// `overflow`) and `running_count` are plain neutral text, never appraised.
function DecisionBlock({
  decision,
  index,
  onSelect,
  selectedKey,
}: {
  decision: DecisionInventoryWire;
  index: Map<string, SelectedRecord>;
  onSelect?: (sel: SelectedRecord) => void;
  selectedKey: string | null;
}) {
  const resolved = index.get(decision.slug);
  const selected =
    resolved !== undefined && selectedKey === selectedRecordKey(resolved.repoPath, decision.slug);
  return (
    <div data-testid="r-inventory-decision">
      <button
        type="button"
        onClick={() => {
          if (resolved !== undefined) onSelect?.(resolved);
        }}
        aria-current={selected ? "true" : undefined}
        className={`w-full rounded px-1 py-0.5 text-left transition-colors hover:bg-surface-strong/40 ${
          selected ? "bg-surface-strong/40" : ""
        }`}
      >
        <span className="text-foreground">{decision.display}</span>
        <div className="text-[11px] text-subtle-foreground">
          {decision.frontmatter_status} · {decision.serving_health} · {decision.running_count}{" "}
          running
        </div>
      </button>
      {decision.serving.length > 0 && (
        <ul className="mt-0.5 space-y-0.5 pl-3">
          {decision.serving.map((approach) => (
            <ApproachRow
              key={approach.slug}
              approach={approach}
              index={index}
              onSelect={onSelect}
              selectedKey={selectedKey}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

// One approach row — its `projected_status`, work-residual (count + the
// outstanding ids), and liveness (`stalled` present-only + the last-fact
// date). All plain neutral text: residual-count and `stalled` are
// mechanical facts, never alarms. The whole row is a button that opens the
// approach in R₂.
function ApproachRow({
  approach,
  index,
  onSelect,
  selectedKey,
}: {
  approach: ApproachInventoryWire;
  index: Map<string, SelectedRecord>;
  onSelect?: (sel: SelectedRecord) => void;
  selectedKey: string | null;
}) {
  const resolved = index.get(approach.slug);
  const selected =
    resolved !== undefined && selectedKey === selectedRecordKey(resolved.repoPath, approach.slug);
  const { work_residual, liveness } = approach;
  return (
    <li className="leading-snug" data-testid="r-inventory-approach">
      <button
        type="button"
        onClick={() => {
          if (resolved !== undefined) onSelect?.(resolved);
        }}
        aria-current={selected ? "true" : undefined}
        className={`w-full rounded px-1 py-0.5 text-left transition-colors hover:bg-surface-strong/40 ${
          selected ? "bg-surface-strong/40" : ""
        }`}
      >
        <span className="text-foreground">{approach.display}</span>
        <div className="text-[11px] text-subtle-foreground">
          {approach.projected_status} · {work_residual.count} outstanding
          {work_residual.count > 0 && (
            <span className="text-muted-foreground"> ({work_residual.outstanding.join(", ")})</span>
          )}{" "}
          · {liveness.stalled && <span className="text-foreground">stalled · </span>}
          last fact {liveness.last_fact ?? "—"}
        </div>
      </button>
    </li>
  );
}
