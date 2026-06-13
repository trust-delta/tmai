// 📋 Issues — R panel's raw issue inventory (R₁).
//
// Reuses `useUnitIssues` (one source — the issues twin of `useUnitPrs`).
// Shows open issues grouped by repo across the whole unit. Each row carries
// a colour-coded lifecycle status pill (open / closed) from the wire
// `state` (C2, Stage C aim-console convergence) — categorical state colour,
// NOT severity appraisal (see `status-pills.tsx`). The unit-scoped endpoint
// returns OPEN issues already, so there is no client-side `state` filter
// (matching `RPrsSection`); the header count is the sum across repos.
//
// A row click opens the issue in the R₂ viewer column (`RIssueViewer`),
// mirroring `RPrsSection`'s `onSelectIssue` / `selectedKey` /
// `aria-current` exactly — the github.com link-out that used to live on
// the issue number is gone; the issue's full content is reviewed in-tmai
// with no round-trip.

import type { AttentionControls } from "@/hooks/useUnitAttention";
import { useUnitIssues } from "@/hooks/useUnitIssues";
import type { IssueInfo, IssueSummaryWire, RepoIssuesWire } from "@/lib/api";
import { RowAttentionMarker } from "./AttentionMarker";
import { type SelectedIssue, selectedIssueKey } from "./r-viewer/RIssueViewer";
import { issueVocabTimestamp, isUnobserved, unobservedIssueCount } from "./remote-delta";
import { Section } from "./Section";
import { ExternalSourceBadge, issueStatusPills, StatusPills } from "./status-pills";
import { UnobservedDelta } from "./UnobservedDelta";

interface RIssuesSectionProps {
  unitName: string | null;
  expanded: boolean;
  onToggle: () => void;
  /** Open an issue in the R₂ viewer column. Optional so the section still
   *  renders standalone (e.g. in isolation tests). */
  onSelectIssue?: (sel: SelectedIssue) => void;
  /** `selectedIssueKey(repoPath, number)` of the issue currently open in
   *  R₂, so the row marks itself as the one being viewed (a mechanical
   *  "open here" fact, not appraisal). */
  selectedKey?: string | null;
  /** Per-artifact attention controls (threaded from `RPanel`'s single hook).
   *  When present each issue row shows its attention marker; absent (e.g. in
   *  isolation tests) the rows render marker-free. */
  attention?: AttentionControls;
  /** Remote-Δ effective cursor for this section (#822) — MAX(panel close,
   *  Issues-section close), threaded from `RPanel`. `null` = no close act
   *  recorded yet (first run → every row unobserved); `undefined` = no
   *  freshness wiring at all (e.g. isolation tests), rows render
   *  accent-free. */
  deltaCursor?: string | null;
}

export function RIssuesSection({
  unitName,
  expanded,
  onToggle,
  onSelectIssue,
  selectedKey,
  attention,
  deltaCursor,
}: RIssuesSectionProps) {
  const { data, loading, error } = useUnitIssues(unitName);
  const total = data === null ? 0 : data.repos.reduce((n, r) => n + r.issues.length, 0);
  const unobserved =
    deltaCursor === undefined ? undefined : unobservedIssueCount(data?.repos ?? null, deltaCursor);

  return (
    <Section
      id="issues"
      glyph="📋"
      label="Issues"
      count={`${total} open`}
      expanded={expanded}
      onToggle={onToggle}
      headerNote={<ExternalSourceBadge />}
      unobservedCount={unobserved}
    >
      <Body
        unitName={unitName}
        repos={data?.repos ?? null}
        loading={loading}
        error={error}
        onSelectIssue={onSelectIssue}
        selectedKey={selectedKey ?? null}
        attention={attention}
        deltaCursor={deltaCursor}
      />
    </Section>
  );
}

interface BodyProps {
  unitName: string | null;
  repos: RepoIssuesWire[] | null;
  loading: boolean;
  error: Error | null;
  onSelectIssue?: (sel: SelectedIssue) => void;
  selectedKey: string | null;
  attention?: AttentionControls;
  deltaCursor?: string | null;
}

function Body({
  unitName,
  repos,
  loading,
  error,
  onSelectIssue,
  selectedKey,
  attention,
  deltaCursor,
}: BodyProps) {
  if (unitName === null) {
    return <p className="text-subtle-foreground">Pick a project to see issues.</p>;
  }
  if (error !== null) {
    return <p className="text-muted-foreground">Failed to load issues: {error.message}</p>;
  }
  if (repos === null && loading) {
    return <p className="text-subtle-foreground">Loading…</p>;
  }
  if (repos === null || repos.every((r) => r.issues.length === 0)) {
    return <p className="text-subtle-foreground">No issues.</p>;
  }
  const multiRepo = repos.length > 1;
  return (
    <div className="space-y-2">
      {repos.map((repo) => (
        <RepoBlock
          key={repo.repo_path}
          repo={repo}
          multiRepo={multiRepo}
          onSelectIssue={onSelectIssue}
          selectedKey={selectedKey}
          attention={attention}
          deltaCursor={deltaCursor}
        />
      ))}
    </div>
  );
}

function RepoBlock({
  repo,
  multiRepo,
  onSelectIssue,
  selectedKey,
  attention,
  deltaCursor,
}: {
  repo: RepoIssuesWire;
  multiRepo: boolean;
  onSelectIssue?: (sel: SelectedIssue) => void;
  selectedKey: string | null;
  attention?: AttentionControls;
  deltaCursor?: string | null;
}) {
  if (repo.issues.length === 0) return null;
  return (
    <div>
      {multiRepo && (
        <p className="text-[11px] uppercase tracking-wide text-subtle-foreground">
          {repo.repo_label}
        </p>
      )}
      <ul className="space-y-1">
        {repo.issues.map((issue) => (
          <IssueRow
            key={`${repo.repo_path}#${issue.number}`}
            issue={issue}
            repoPath={repo.repo_path}
            repoLabel={repo.repo_label}
            onSelectIssue={onSelectIssue}
            selected={selectedKey === selectedIssueKey(repo.repo_path, Number(issue.number))}
            attention={attention}
            unobserved={
              deltaCursor !== undefined && isUnobserved(issueVocabTimestamp(issue), deltaCursor)
            }
          />
        ))}
      </ul>
    </div>
  );
}

function IssueRow({
  issue,
  repoPath,
  repoLabel,
  onSelectIssue,
  selected,
  attention,
  unobserved,
}: {
  issue: IssueSummaryWire;
  repoPath: string;
  repoLabel: string;
  onSelectIssue?: (sel: SelectedIssue) => void;
  selected: boolean;
  attention?: AttentionControls;
  unobserved?: boolean;
}) {
  // The whole row is a button that opens the issue in the R₂ viewer —
  // there is NO github.com link-out anymore; the issue's full content is
  // reviewed in-tmai. `aria-current` marks the row whose content is
  // currently open in R₂ (a mechanical "open here" fact, not appraisal).
  //
  // bigint→number at the selection boundary: the wire types issue numbers
  // as bigint (u64), but `SelectedIssue.issue` is `IssueInfo` and the
  // downstream `useIssueDetail` / `selectedIssueKey` take a plain number.
  // `IssueSummaryWire` is otherwise field-for-field `IssueInfo`, so the
  // spread narrows just the number and leaves the rest byte-identical.
  const selectedIssue: IssueInfo = { ...issue, number: Number(issue.number) };
  return (
    <li className="flex items-start gap-1.5 leading-snug">
      {/* Attention marker sits to the LEFT of the row (contract §3 core). */}
      <span className="pt-0.5">
        <RowAttentionMarker
          attention={attention}
          repoPath={repoPath}
          section="issue"
          id={String(issue.number)}
          label={`#${Number(issue.number)}`}
        />
      </span>
      <button
        type="button"
        onClick={() => onSelectIssue?.({ repoPath, repoLabel, issue: selectedIssue })}
        aria-current={selected ? "true" : undefined}
        className={`min-w-0 flex-1 rounded px-1 py-0.5 text-left transition-colors hover:bg-surface-strong/40 ${
          selected ? "bg-surface-strong/40" : ""
        }`}
      >
        <span>
          {/* Remote-Δ accent (#822): leading Δ when this row's vocab ts is
              newer than the close-act cursor. Observed rows render unchanged. */}
          {unobserved === true && <UnobservedDelta />}
          <span className="font-mono text-foreground">#{Number(issue.number)}</span>{" "}
          <span className="text-foreground">{issue.title}</span>
        </span>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-subtle-foreground">
          <StatusPills pills={issueStatusPills(issue)} />
          {issue.labels.length > 0 && (
            <span className="font-mono">{issue.labels.map((l) => l.name).join(", ")}</span>
          )}
        </div>
      </button>
    </li>
  );
}
