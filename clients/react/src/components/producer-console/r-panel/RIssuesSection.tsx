// 📋 Issues — R panel's raw issue inventory (R₁).
//
// Reuses `useUnitIssues` (one source — the issues twin of `useUnitPrs`).
// Shows open issues grouped by repo across the whole unit, no
// severity-color badges. R₁ intentionally carries NO appraisal-flavoured
// badges (no `text-warning` / `text-success` / `text-destructive`) — an
// issue's state / labels are facts, not triage. The unit-scoped endpoint
// returns OPEN issues already, so there is no client-side `state` filter
// (matching `RPrsSection`); the header count is the sum across repos.
//
// A row click opens the issue in the R₂ viewer column (`RIssueViewer`),
// mirroring `RPrsSection`'s `onSelectIssue` / `selectedKey` /
// `aria-current` exactly — the github.com link-out that used to live on
// the issue number is gone; the issue's full content is reviewed in-tmai
// with no round-trip. R₁ stays a pure inventory; the row is just a select.

import { useUnitIssues } from "@/hooks/useUnitIssues";
import type { IssueInfo, IssueSummaryWire, RepoIssuesWire } from "@/lib/api";
import { type SelectedIssue, selectedIssueKey } from "./r-viewer/RIssueViewer";
import { Section } from "./Section";

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
}

export function RIssuesSection({
  unitName,
  expanded,
  onToggle,
  onSelectIssue,
  selectedKey,
}: RIssuesSectionProps) {
  const { data, loading, error } = useUnitIssues(unitName);
  const total = data === null ? 0 : data.repos.reduce((n, r) => n + r.issues.length, 0);

  return (
    <Section
      id="issues"
      glyph="📋"
      label="Issues"
      count={`${total} open`}
      expanded={expanded}
      onToggle={onToggle}
    >
      <Body
        unitName={unitName}
        repos={data?.repos ?? null}
        loading={loading}
        error={error}
        onSelectIssue={onSelectIssue}
        selectedKey={selectedKey ?? null}
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
}

function Body({ unitName, repos, loading, error, onSelectIssue, selectedKey }: BodyProps) {
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
}: {
  repo: RepoIssuesWire;
  multiRepo: boolean;
  onSelectIssue?: (sel: SelectedIssue) => void;
  selectedKey: string | null;
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
}: {
  issue: IssueSummaryWire;
  repoPath: string;
  repoLabel: string;
  onSelectIssue?: (sel: SelectedIssue) => void;
  selected: boolean;
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
    <li className="leading-snug">
      <button
        type="button"
        onClick={() => onSelectIssue?.({ repoPath, repoLabel, issue: selectedIssue })}
        aria-current={selected ? "true" : undefined}
        className={`w-full rounded px-1 py-0.5 text-left transition-colors hover:bg-surface-strong/40 ${
          selected ? "bg-surface-strong/40" : ""
        }`}
      >
        <span>
          <span className="font-mono text-foreground">#{Number(issue.number)}</span>{" "}
          <span className="text-foreground">{issue.title}</span>
        </span>
        <div className="text-[11px] text-subtle-foreground">
          {issue.state.toLowerCase()}
          {issue.labels.length > 0 && ` · ${issue.labels.map((l) => l.name).join(", ")}`}
        </div>
      </button>
    </li>
  );
}
