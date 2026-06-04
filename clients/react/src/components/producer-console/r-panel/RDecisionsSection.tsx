// ⬡ Decisions — R panel's raw decision inventory.
//
// Flat chronological list by `last_verified` desc. Deliberately NOT
// bucketed by temperature (`foundations` / `in_play` / `warm` / `cold`)
// — that's C's `SettledDecisionsSection`'s briefing-layer
// responsibility. R is raw inventory: plain ordering, no tmai-side
// appraisal. See the approach's R section table.

import { useDecisions } from "@/hooks/useDecisions";
import type { AttentionControls } from "@/hooks/useUnitAttention";
import type { DecisionWire, RepoDecisionsWire } from "@/lib/api";
import { RowAttentionMarker } from "./AttentionMarker";
import { type SelectedRecord, selectedRecordKey } from "./r-viewer/RRecordViewer";
import { Section } from "./Section";

interface RDecisionsSectionProps {
  unitName: string | null;
  expanded: boolean;
  onToggle: () => void;
  /** Open a decision in the R₂ record viewer column. Clicking a row
   *  selects it for in-tmai viewing (mirrors `RPrsSection.onSelectPr`).
   *  Optional so the section still renders standalone in isolation. */
  onSelect?: (sel: SelectedRecord) => void;
  /** `selectedRecordKey(repoPath, slug)` of the record currently open in
   *  R₂, so the row marks itself as the one being viewed (a mechanical
   *  "open here" fact, not appraisal). */
  selectedKey?: string | null;
  /** Per-artifact attention controls (threaded from `RPanel`'s single hook).
   *  When present each decision row shows its attention marker; absent (e.g.
   *  in isolation tests) the rows render marker-free. */
  attention?: AttentionControls;
}

export function RDecisionsSection({
  unitName,
  expanded,
  onToggle,
  onSelect,
  selectedKey,
  attention,
}: RDecisionsSectionProps) {
  const { data, loading, error } = useDecisions(unitName);
  const total = data === null ? 0 : data.repos.reduce((n, r) => n + flattenAll(r).length, 0);

  return (
    <Section
      id="decisions"
      glyph="⬡"
      label="Decisions"
      count={`${total}`}
      expanded={expanded}
      onToggle={onToggle}
    >
      <Body
        unitName={unitName}
        repos={data?.repos ?? null}
        loading={loading}
        error={error}
        onSelect={onSelect}
        selectedKey={selectedKey ?? null}
        attention={attention}
      />
    </Section>
  );
}

function flattenAll(repo: RepoDecisionsWire): DecisionWire[] {
  return [...repo.foundations, ...repo.in_play, ...repo.warm, ...repo.cold, ...repo.superseded];
}

interface BodyProps {
  unitName: string | null;
  repos: RepoDecisionsWire[] | null;
  loading: boolean;
  error: Error | null;
  onSelect?: (sel: SelectedRecord) => void;
  selectedKey: string | null;
  attention?: AttentionControls;
}

function Body({ unitName, repos, loading, error, onSelect, selectedKey, attention }: BodyProps) {
  if (unitName === null) {
    return <p className="text-subtle-foreground">Pick a project to see decisions.</p>;
  }
  if (error !== null) {
    return <p className="text-muted-foreground">Failed to load decisions: {error.message}</p>;
  }
  if (repos === null && loading) {
    return <p className="text-subtle-foreground">Loading…</p>;
  }
  if (repos === null || repos.length === 0 || repos.every((r) => flattenAll(r).length === 0)) {
    return <p className="text-subtle-foreground">No decisions.</p>;
  }
  const multiRepo = repos.length > 1;
  return (
    <div className="space-y-2">
      {repos.map((repo) => {
        const sorted = [...flattenAll(repo)].sort((a, b) =>
          b.last_verified.localeCompare(a.last_verified),
        );
        if (sorted.length === 0) return null;
        return (
          <div key={repo.repo_root}>
            {multiRepo && (
              <p className="text-[11px] uppercase tracking-wide text-subtle-foreground">
                {repo.repo_label}
              </p>
            )}
            <ul className="space-y-0.5">
              {sorted.map((d) => (
                <DecisionRow
                  key={d.slug}
                  decision={d}
                  repoPath={repo.repo_root}
                  repoLabel={repo.repo_label}
                  onSelect={onSelect}
                  selected={selectedKey === selectedRecordKey(repo.repo_root, d.slug)}
                  attention={attention}
                />
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

// The whole row is a button that opens the decision in the R₂ record
// viewer (mirrors `RPrsSection`'s `PrRow`). `aria-current` marks the row
// whose content is currently open in R₂ — a mechanical "open here" fact,
// no severity styling.
function DecisionRow({
  decision,
  repoPath,
  repoLabel,
  onSelect,
  selected,
  attention,
}: {
  decision: DecisionWire;
  repoPath: string;
  repoLabel: string;
  onSelect?: (sel: SelectedRecord) => void;
  selected: boolean;
  attention?: AttentionControls;
}) {
  return (
    <li className="flex items-start gap-1.5 leading-snug">
      {/* Attention marker sits to the LEFT of the row (contract §3 core). */}
      <span className="pt-0.5">
        <RowAttentionMarker
          attention={attention}
          repoPath={repoPath}
          section="decision"
          id={decision.slug}
          label={decision.slug}
        />
      </span>
      <button
        type="button"
        onClick={() => onSelect?.({ kind: "decision", repoPath, repoLabel, record: decision })}
        aria-current={selected ? "true" : undefined}
        className={`min-w-0 flex-1 rounded px-1 py-0.5 text-left transition-colors hover:bg-surface-strong/40 ${
          selected ? "bg-surface-strong/40" : ""
        }`}
      >
        <span className="font-mono text-subtle-foreground">{decision.last_verified}</span>{" "}
        <span className="text-foreground">{decision.title}</span>
        <div className="text-[11px] text-subtle-foreground">
          {decision.slug} · {decision.status}
          {/* Drift = a `governs:` path changed after `last_verified`
              (currency re-verify due). Present-only and PLAIN — surfaced
              for "should I look?" scanning, never an alarm. The path/date
              detail stays in R₂'s DriftIndicator. */}
          {decision.stale_since !== null && <span className="text-foreground"> · drift</span>}
        </div>
      </button>
    </li>
  );
}
