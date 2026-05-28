// 🔀 PRs — R panel's raw PR inventory.
//
// Reuses `useUnitPrs` (the same wire C's `🔀 Unit PRs` reads — one
// source, two consumers). Shows open PRs grouped by repo, no
// severity-color badges. Mechanical CI / review state is plain text:
// the R panel intentionally does NOT carry the appraisal-flavoured
// badges of C's `UnitPrsSection` (no `text-warning` / `text-success`
// / `text-destructive`) — see the approach's "tmai は何を絶対しない"
// rules 2 and 4.

import { useUnitPrs } from "@/hooks/useUnitPrs";
import type { PrSummaryWire, RepoPrsWire } from "@/lib/api";
import { Section } from "./Section";

interface RPrsSectionProps {
  unitName: string | null;
  expanded: boolean;
  onToggle: () => void;
}

export function RPrsSection({ unitName, expanded, onToggle }: RPrsSectionProps) {
  const { data, loading, error } = useUnitPrs(unitName);
  const total = data === null ? 0 : data.repos.reduce((n, r) => n + r.prs.length, 0);

  return (
    <Section
      id="prs"
      glyph="🔀"
      label="PRs"
      count={`${total} open`}
      expanded={expanded}
      onToggle={onToggle}
    >
      <Body unitName={unitName} repos={data?.repos ?? null} loading={loading} error={error} />
    </Section>
  );
}

interface BodyProps {
  unitName: string | null;
  repos: RepoPrsWire[] | null;
  loading: boolean;
  error: Error | null;
}

function Body({ unitName, repos, loading, error }: BodyProps) {
  if (unitName === null) {
    return <p className="text-subtle-foreground">Pick a project to see open PRs.</p>;
  }
  if (error !== null) {
    return <p className="text-muted-foreground">Failed to load PRs: {error.message}</p>;
  }
  if (repos === null && loading) {
    return <p className="text-subtle-foreground">Loading…</p>;
  }
  if (repos === null || repos.every((r) => r.prs.length === 0)) {
    return <p className="text-subtle-foreground">No open PRs.</p>;
  }
  const multiRepo = repos.length > 1;
  return (
    <div className="space-y-2">
      {repos.map((repo) => (
        <RepoBlock key={repo.repo_path} repo={repo} multiRepo={multiRepo} />
      ))}
    </div>
  );
}

function RepoBlock({ repo, multiRepo }: { repo: RepoPrsWire; multiRepo: boolean }) {
  if (repo.prs.length === 0) return null;
  return (
    <div>
      {multiRepo && (
        <p className="text-[11px] uppercase tracking-wide text-subtle-foreground">
          {repo.repo_label}
        </p>
      )}
      <ul className="space-y-1">
        {repo.prs.map((pr) => (
          <PrRow key={`${repo.repo_path}#${pr.number}`} pr={pr} />
        ))}
      </ul>
    </div>
  );
}

function PrRow({ pr }: { pr: PrSummaryWire }) {
  // Plain-text status — no severity-color CI / review badges. The
  // operator can read "CI SUCCESS" / "CI FAILURE" identically; R
  // is inventory, not triage.
  return (
    <li className="leading-snug">
      <a
        href={pr.url}
        target="_blank"
        rel="noopener noreferrer"
        className="font-mono text-foreground hover:underline"
      >
        #{Number(pr.number)}
      </a>{" "}
      <span className="text-foreground">{pr.title}</span>
      <div className="text-[11px] text-subtle-foreground">
        {pr.head_branch} → {pr.base_branch}
        {pr.check_status !== null && ` · CI ${pr.check_status}`}
        {pr.review_decision !== null && ` · ${pr.review_decision}`}
        {pr.is_draft && " · draft"}
      </div>
    </li>
  );
}
