// ◇ Observations — R panel's raw observation inventory; the 5th
// attention-artifact section (`pr | issue | decision | approach |
// observation`), the local-dimension peer of decisions / approaches.
//
// Contract: `tmai-core:doc/approaches/2026-06-04-attention-as-per-artifact-field.md`
// §key (observation = local-dimension attention-artifact). Each row carries
// its own `RowAttentionMarker` (`section="observation"`, `repoPath=repo_root`
// — same keying as decisions / approaches, #493).
//
// Deliberately FLATTER than RApproachesSection: an observation has no
// lifecycle and nothing rich to open in R₂ (`ObservationWire` carries only
// `slug` / `summary` / `status`), so rows are NOT clickable-to-viewer and the
// row's `status` (`high | medium | low`) shows as a plain inline badge rather
// than a status-group header. The badge is the author's appraisal weight, but
// it is rendered with zero severity styling (subtle-foreground only) — R is
// inventory, tmai does not weight it.

import type { AttentionControls } from "@/hooks/useUnitAttention";
import { useUnitObservations } from "@/hooks/useUnitObservations";
import type { ObservationWire, RepoObservationsWire } from "@/lib/api";
import { RowAttentionMarker } from "./AttentionMarker";
import { Section } from "./Section";

interface RObservationsSectionProps {
  unitName: string | null;
  expanded: boolean;
  onToggle: () => void;
  /** Per-artifact attention controls (threaded from `RPanel`'s single hook).
   *  When present each observation row shows its attention marker; absent
   *  (e.g. in isolation tests) the rows render marker-free. */
  attention?: AttentionControls;
}

export function RObservationsSection({
  unitName,
  expanded,
  onToggle,
  attention,
}: RObservationsSectionProps) {
  const { data, loading, error } = useUnitObservations(unitName);
  const total = data === null ? 0 : data.repos.reduce((n, r) => n + r.observations.length, 0);

  return (
    <Section
      id="observations"
      glyph="◇"
      label="Observations"
      count={`${total}`}
      expanded={expanded}
      onToggle={onToggle}
    >
      <Body
        unitName={unitName}
        repos={data?.repos ?? null}
        loading={loading}
        error={error}
        attention={attention}
      />
    </Section>
  );
}

interface BodyProps {
  unitName: string | null;
  repos: RepoObservationsWire[] | null;
  loading: boolean;
  error: Error | null;
  attention?: AttentionControls;
}

function Body({ unitName, repos, loading, error, attention }: BodyProps) {
  if (unitName === null) {
    return <p className="text-subtle-foreground">Pick a project to see observations.</p>;
  }
  if (error !== null) {
    return <p className="text-muted-foreground">Failed to load observations: {error.message}</p>;
  }
  if (repos === null && loading) {
    return <p className="text-subtle-foreground">Loading…</p>;
  }
  if (repos === null || repos.length === 0 || repos.every((r) => r.observations.length === 0)) {
    return <p className="text-subtle-foreground">No observations.</p>;
  }
  const multiRepo = repos.length > 1;
  return (
    <div className="space-y-2">
      {repos.map((repo) => (
        <RepoBlock key={repo.repo_root} repo={repo} multiRepo={multiRepo} attention={attention} />
      ))}
    </div>
  );
}

function RepoBlock({
  repo,
  multiRepo,
  attention,
}: {
  repo: RepoObservationsWire;
  multiRepo: boolean;
  attention?: AttentionControls;
}) {
  // Flat list, no status grouping — sorted most-recent-first by slug. The
  // wire already arrives in this order; we sort defensively so the order is
  // self-evident from the component, not assumed from the server.
  const observations = [...repo.observations].sort((a, b) => b.slug.localeCompare(a.slug));
  return (
    <div>
      {multiRepo && (
        <p className="text-[11px] uppercase tracking-wide text-subtle-foreground">
          {repo.repo_label}
        </p>
      )}
      <ul className="space-y-0.5">
        {observations.map((o) => (
          <ObservationRow
            key={o.slug}
            observation={o}
            repoPath={repo.repo_root}
            attention={attention}
          />
        ))}
      </ul>
    </div>
  );
}

// One observation row: attention marker + summary + status badge. Unlike
// `ApproachRow` the row is NOT a button — an observation has no record viewer
// to open (the wire carries no body), so there is nothing to select into R₂.
function ObservationRow({
  observation,
  repoPath,
  attention,
}: {
  observation: ObservationWire;
  repoPath: string;
  attention?: AttentionControls;
}) {
  return (
    <li className="flex items-start gap-1.5 leading-snug">
      {/* Attention marker sits to the LEFT of the row (contract §3 core). */}
      <span className="pt-0.5">
        <RowAttentionMarker
          attention={attention}
          repoPath={repoPath}
          section="observation"
          id={observation.slug}
          label={observation.slug}
        />
      </span>
      <div className="min-w-0 flex-1 px-1 py-0.5">
        <div className="flex items-baseline gap-1.5">
          <span className="min-w-0 flex-1 text-foreground">{observation.summary}</span>
          {/* status badge — the author's appraisal weight, rendered plain
              (subtle-foreground, no severity accent): R shows it, tmai does
              not weight it. */}
          <span
            data-testid="observation-status"
            className="shrink-0 rounded bg-surface-strong/40 px-1 text-[10px] uppercase tracking-wide text-subtle-foreground"
          >
            {observation.status}
          </span>
        </div>
        <div className="text-[11px] text-subtle-foreground">{observation.slug}</div>
      </div>
    </li>
  );
}
