// ▣ Approaches — R panel's raw approach inventory.
//
// Status group → date desc within. The status order is `running`,
// `ready`, `planned`, `partial`, `validated`, `rejected`, `replaced`
// — but R deliberately
// drops the verification-debt gauge and the status-pill filter
// chips (those are appraisal surfaces, see the approach's negative
// space rules). R = inventory; the operator reads the list, tmai
// does not weight it.
//
// Count fact = total approaches running (the same number the gauge
// would show), but rendered as plain `text-subtle-foreground` so
// the header carries zero severity meaning.

import { useApproaches } from "@/hooks/useApproaches";
import type { ApproachStatus, ApproachWire, RepoApproachesWire } from "@/lib/api";
import { type SelectedRecord, selectedRecordKey } from "./r-viewer/RRecordViewer";
import { isReviewTriggerReady } from "./r-viewer/review-trigger";
import { Section } from "./Section";

interface RApproachesSectionProps {
  unitName: string | null;
  expanded: boolean;
  onToggle: () => void;
  /** Open an approach in the R₂ record viewer column (mirrors
   *  `RPrsSection.onSelectPr`). Optional so the section still renders
   *  standalone in isolation. */
  onSelect?: (sel: SelectedRecord) => void;
  /** `selectedRecordKey(repoPath, slug)` of the record currently open in
   *  R₂, so the row marks itself as the one being viewed. */
  selectedKey?: string | null;
}

const STATUS_ORDER: readonly ApproachStatus[] = [
  "running",
  "ready",
  "planned",
  "partial",
  "validated",
  "rejected",
  "replaced",
];

export function RApproachesSection({
  unitName,
  expanded,
  onToggle,
  onSelect,
  selectedKey,
}: RApproachesSectionProps) {
  const { data, loading, error } = useApproaches(unitName);
  const running =
    data === null
      ? 0
      : data.repos.reduce(
          (n, r) => n + r.approaches.filter((a) => a.status === "running").length,
          0,
        );

  return (
    <Section
      id="approaches"
      glyph="▣"
      label="Approaches"
      count={`${running} running`}
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
      />
    </Section>
  );
}

interface BodyProps {
  unitName: string | null;
  repos: RepoApproachesWire[] | null;
  loading: boolean;
  error: Error | null;
  onSelect?: (sel: SelectedRecord) => void;
  selectedKey: string | null;
}

function Body({ unitName, repos, loading, error, onSelect, selectedKey }: BodyProps) {
  if (unitName === null) {
    return <p className="text-subtle-foreground">Pick a project to see approaches.</p>;
  }
  if (error !== null) {
    return <p className="text-muted-foreground">Failed to load approaches: {error.message}</p>;
  }
  if (repos === null && loading) {
    return <p className="text-subtle-foreground">Loading…</p>;
  }
  if (repos === null || repos.length === 0 || repos.every((r) => r.approaches.length === 0)) {
    return <p className="text-subtle-foreground">No approaches.</p>;
  }
  const multiRepo = repos.length > 1;
  return (
    <div className="space-y-2">
      {repos.map((repo) => (
        <RepoBlock
          key={repo.repo_root}
          repo={repo}
          multiRepo={multiRepo}
          onSelect={onSelect}
          selectedKey={selectedKey}
        />
      ))}
    </div>
  );
}

function RepoBlock({
  repo,
  multiRepo,
  onSelect,
  selectedKey,
}: {
  repo: RepoApproachesWire;
  multiRepo: boolean;
  onSelect?: (sel: SelectedRecord) => void;
  selectedKey: string | null;
}) {
  // Group by status then sort by date desc within each group. No
  // filter chips — every status is shown, every item is rendered.
  const byStatus = new Map<ApproachStatus, ApproachWire[]>();
  for (const a of repo.approaches) {
    const list = byStatus.get(a.status) ?? [];
    list.push(a);
    byStatus.set(a.status, list);
  }
  for (const [, list] of byStatus) {
    list.sort((a, b) => b.date.localeCompare(a.date));
  }
  return (
    <div>
      {multiRepo && (
        <p className="text-[11px] uppercase tracking-wide text-subtle-foreground">
          {repo.repo_label}
        </p>
      )}
      {STATUS_ORDER.map((status) => {
        const list = byStatus.get(status);
        if (!list || list.length === 0) return null;
        return (
          <div key={status} className="mt-1">
            <p className="text-[11px] uppercase tracking-wide text-subtle-foreground">
              {status} ({list.length})
            </p>
            <ul className="space-y-0.5">
              {list.map((a) => (
                <ApproachRow
                  key={a.slug}
                  approach={a}
                  repoPath={repo.repo_root}
                  repoLabel={repo.repo_label}
                  onSelect={onSelect}
                  selected={selectedKey === selectedRecordKey(repo.repo_root, a.slug)}
                />
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

// The whole row is a button that opens the approach in the R₂ record
// viewer (mirrors `RPrsSection`'s `PrRow`). `aria-current` marks the row
// whose content is currently open in R₂ — a mechanical "open here" fact,
// no severity styling.
function ApproachRow({
  approach,
  repoPath,
  repoLabel,
  onSelect,
  selected,
}: {
  approach: ApproachWire;
  repoPath: string;
  repoLabel: string;
  onSelect?: (sel: SelectedRecord) => void;
  selected: boolean;
}) {
  return (
    <li className="leading-snug">
      <button
        type="button"
        onClick={() => onSelect?.({ kind: "approach", repoPath, repoLabel, record: approach })}
        aria-current={selected ? "true" : undefined}
        className={`w-full rounded px-1 py-0.5 text-left transition-colors hover:bg-surface-strong/40 ${
          selected ? "bg-surface-strong/40" : ""
        }`}
      >
        <span className="font-mono text-subtle-foreground">{approach.date}</span>{" "}
        <span className="text-foreground">{approach.title}</span>
        <div className="text-[11px] text-subtle-foreground">
          {approach.slug} · {approach.status}
          {/* confidence: present-only (`null` = none on record). */}
          {approach.confidence !== null && <> · {approach.confidence}</>}
          {/* review-trigger ready = a date trigger is due (verdict due).
              Present-only and PLAIN — surfaced for "should I look?"
              scanning, never an alarm. The specific triggers stay in R₂'s
              ReviewTriggerIndicator. */}
          {isReviewTriggerReady(approach) && (
            <span className="text-foreground"> · review-trigger ready</span>
          )}
        </div>
      </button>
    </li>
  );
}
