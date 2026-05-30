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
import { type SelectedPr, selectedPrKey } from "./r-viewer/RPrViewer";
import { Section } from "./Section";

interface RPrsSectionProps {
  unitName: string | null;
  expanded: boolean;
  onToggle: () => void;
  /** Open a PR in the R₂ viewer column (#749). The github.com link-out
   *  used to live on the PR number; clicking a row now selects the PR
   *  for in-tmai viewing — no round-trip. Optional so the section still
   *  renders standalone (e.g. in isolation tests). */
  onSelectPr?: (sel: SelectedPr) => void;
  /** `selectedPrKey(repoPath, number)` of the PR currently open in R₂,
   *  so the row marks itself as the one being viewed (a mechanical
   *  "open here" fact, not appraisal). */
  selectedKey?: string | null;
}

export function RPrsSection({
  unitName,
  expanded,
  onToggle,
  onSelectPr,
  selectedKey,
}: RPrsSectionProps) {
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
      <Body
        unitName={unitName}
        repos={data?.repos ?? null}
        loading={loading}
        error={error}
        onSelectPr={onSelectPr}
        selectedKey={selectedKey ?? null}
      />
    </Section>
  );
}

interface BodyProps {
  unitName: string | null;
  repos: RepoPrsWire[] | null;
  loading: boolean;
  error: Error | null;
  onSelectPr?: (sel: SelectedPr) => void;
  selectedKey: string | null;
}

function Body({ unitName, repos, loading, error, onSelectPr, selectedKey }: BodyProps) {
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
        <RepoBlock
          key={repo.repo_path}
          repo={repo}
          multiRepo={multiRepo}
          onSelectPr={onSelectPr}
          selectedKey={selectedKey}
        />
      ))}
    </div>
  );
}

function RepoBlock({
  repo,
  multiRepo,
  onSelectPr,
  selectedKey,
}: {
  repo: RepoPrsWire;
  multiRepo: boolean;
  onSelectPr?: (sel: SelectedPr) => void;
  selectedKey: string | null;
}) {
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
          <PrRow
            key={`${repo.repo_path}#${pr.number}`}
            pr={pr}
            repoPath={repo.repo_path}
            repoLabel={repo.repo_label}
            onSelectPr={onSelectPr}
            selected={selectedKey === selectedPrKey(repo.repo_path, pr.number)}
          />
        ))}
      </ul>
    </div>
  );
}

function PrRow({
  pr,
  repoPath,
  repoLabel,
  onSelectPr,
  selected,
}: {
  pr: PrSummaryWire;
  repoPath: string;
  repoLabel: string;
  onSelectPr?: (sel: SelectedPr) => void;
  selected: boolean;
}) {
  // Plain-text status — no severity-color CI / review badges. The
  // operator can read "CI SUCCESS" / "CI FAILURE" identically; R is
  // inventory, not triage.
  //
  // The whole row is a button that opens the PR in the R₂ viewer
  // (#749) — there is NO github.com link-out anymore; the PR's full
  // content is reviewed in-tmai. `aria-current` marks the row whose
  // content is currently open in R₂ (a mechanical "open here" fact).
  return (
    <li className="leading-snug">
      <button
        type="button"
        onClick={() => onSelectPr?.({ repoPath, repoLabel, pr })}
        aria-current={selected ? "true" : undefined}
        className={`w-full rounded px-1 py-0.5 text-left transition-colors hover:bg-surface-strong/40 ${
          selected ? "bg-surface-strong/40" : ""
        }`}
      >
        <span>
          <span className="font-mono text-foreground">#{Number(pr.number)}</span>{" "}
          <span className="text-foreground">{pr.title}</span>
        </span>
        <div className="text-[11px] text-subtle-foreground">
          {pr.head_branch} → {pr.base_branch}
          {pr.check_status !== null && ` · CI ${pr.check_status}`}
          {pr.review_decision !== null && ` · ${pr.review_decision}`}
          {pr.is_draft && " · draft"}
        </div>
      </button>
    </li>
  );
}
