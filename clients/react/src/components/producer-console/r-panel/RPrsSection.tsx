// 🔀 PRs — R panel's raw PR inventory (R₁).
//
// Reuses `useUnitPrs` (one source). Shows open PRs grouped by repo. Each
// row carries colour-coded lifecycle / review / CI status pills (C2, Stage
// C aim-console convergence) so the operator scans the inventory's shape
// without opening every R₂ viewer (where these facts used to live only).
//
// Those pill colours are CATEGORICAL (which state), NOT appraisal — see
// `status-pills.tsx`'s header for why this is consistent with the R₁
// "tmai states facts, not appraisals" posture
// (`2026-05-26-tmai-states-facts-not-appraisals`): the colour names a
// lifecycle state, it never ranks urgency/importance.
//
// The C-column `UnitPrsSection` that once mirrored this inventory (and held
// the merge action) is retired; R is now the single PR surface. The merge /
// override / CI-rerun action layer lives in R₂ (`RPrViewer`). A row click
// hands R₂ the PR plus the repo-level `billing_dead` flag (which lives on
// `RepoPrsWire`, not on the PR) so R₂ can offer the billing-dead override.

import { useUnitPrs } from "@/hooks/useUnitPrs";
import type { PrSummaryWire, RepoPrsWire } from "@/lib/api";
import { type SelectedPr, selectedPrKey } from "./r-viewer/RPrViewer";
import { isUnobserved, prVocabTimestamp, unobservedPrCount } from "./remote-delta";
import { Section } from "./Section";
import { ExternalSourceBadge, prStatusPills, StatusPills } from "./status-pills";
import { UnobservedDelta } from "./UnobservedDelta";

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
  /** Remote-Δ effective cursor for this section (#822) — MAX(panel close,
   *  PRs-section close), threaded from `RPanel`. `null` = no close act
   *  recorded yet (first run → every row unobserved); `undefined` = no
   *  freshness wiring at all (e.g. isolation tests), rows render
   *  accent-free. */
  deltaCursor?: string | null;
}

export function RPrsSection({
  unitName,
  expanded,
  onToggle,
  onSelectPr,
  selectedKey,
  deltaCursor,
}: RPrsSectionProps) {
  const { data, loading, error } = useUnitPrs(unitName);
  const total = data === null ? 0 : data.repos.reduce((n, r) => n + r.prs.length, 0);
  const unobserved =
    deltaCursor === undefined ? undefined : unobservedPrCount(data?.repos ?? null, deltaCursor);

  return (
    <Section
      id="prs"
      glyph="🔀"
      label="PRs"
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
        onSelectPr={onSelectPr}
        selectedKey={selectedKey ?? null}
        deltaCursor={deltaCursor}
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
  deltaCursor?: string | null;
}

function Body({
  unitName,
  repos,
  loading,
  error,
  onSelectPr,
  selectedKey,
  deltaCursor,
}: BodyProps) {
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
          deltaCursor={deltaCursor}
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
  deltaCursor,
}: {
  repo: RepoPrsWire;
  multiRepo: boolean;
  onSelectPr?: (sel: SelectedPr) => void;
  selectedKey: string | null;
  deltaCursor?: string | null;
}) {
  if (repo.prs.length === 0) return null;
  // billing-dead lives on the REPO, not the PR. Thread it into the R₂
  // selection so the viewer's override-merge affordance knows whether
  // this PR's repo is flagged. Absent-when-false ⇒ `=== true`.
  const billingDead = repo.billing_dead === true;
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
            billingDead={billingDead}
            onSelectPr={onSelectPr}
            selected={selectedKey === selectedPrKey(repo.repo_path, pr.number)}
            unobserved={
              deltaCursor !== undefined && isUnobserved(prVocabTimestamp(pr), deltaCursor)
            }
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
  billingDead,
  onSelectPr,
  selected,
  unobserved,
}: {
  pr: PrSummaryWire;
  repoPath: string;
  repoLabel: string;
  billingDead: boolean;
  onSelectPr?: (sel: SelectedPr) => void;
  selected: boolean;
  unobserved?: boolean;
}) {
  // Colour-coded status pills (C2) — categorical lifecycle / review / CI
  // state, NOT severity appraisal (see `status-pills.tsx`). The whole row
  // is a button that opens the PR in the R₂ viewer (#749) — there is NO
  // github.com link-out anymore; the PR's full content is reviewed
  // in-tmai. `aria-current` marks the row whose content is currently open
  // in R₂ (a mechanical "open here" fact).
  return (
    <li className="flex items-start gap-1.5 leading-snug">
      <button
        type="button"
        onClick={() => onSelectPr?.({ repoPath, repoLabel, pr, billingDead })}
        aria-current={selected ? "true" : undefined}
        className={`min-w-0 flex-1 rounded px-1 py-0.5 text-left transition-colors hover:bg-surface-strong/40 ${
          selected ? "bg-surface-strong/40" : ""
        }`}
      >
        <span>
          {/* Remote-Δ accent (#822): leading Δ when this row's vocab ts is
              newer than the close-act cursor. Observed rows render unchanged. */}
          {unobserved === true && <UnobservedDelta />}
          <span className="font-mono text-foreground">#{Number(pr.number)}</span>{" "}
          <span className="text-foreground">{pr.title}</span>
        </span>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-subtle-foreground">
          <span className="font-mono">
            {pr.head_branch} → {pr.base_branch}
          </span>
          <StatusPills pills={prStatusPills(pr)} />
        </div>
      </button>
    </li>
  );
}
