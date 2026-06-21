// PrRail — the aim-console's PR / Issue rail (S5). A faithful reproduction of
// the destination mock's PR rail (`origin/mock/aim-ui-sample` → the `.col.pr`
// section) in the dev-tool tokens: a collapsed vertical rail (live PR / Issue
// open-counts + a static `‹ EXTERNAL` framing) that expands to a per-repo
// PR + Issue inventory grouped across the whole unit.
//
// REUSE, DON'T REBUILD: the data comes from `useUnitPrs` / `useUnitIssues`
// (the same unit-scoped, multi-repo hooks the Producer console's R panel
// uses), and each row's categorical status pill is derived by the SAME
// `prStatusPills` / `issueStatusPills` functions (import-only) so the
// lifecycle/CI colour story stays consistent with `RPrsSection` /
// `RIssuesSection`. WHY the pills are rendered here as local `.ac-pst` spans
// instead of the shared `StatusPills` component: `StatusPills` carries the
// producer-console theme classes; the aim-console reproduces the mock's
// dev-tool `.pst` look in its own scoped tokens (issue #801 bounding —
// touch ONLY `aim-console/**` + `aim-console.css`). The colour is still
// CATEGORICAL, never appraisal (`2026-05-26-tmai-states-facts-not-appraisals`):
// it names which lifecycle/CI state a PR/Issue is in, it never ranks urgency.
//
// COEXIST: display-only. The aim-console has no R₂ viewer and the mock rows
// have no detail target, so rows are inert (no click-to-viewer, no
// github.com link-out — the dev-loop stays in-tmai).
//
// The expand/collapse MECHANISM is the S1 shell's (the root's `.pr-open`
// modifier + the grid transition + the `prOpen` state in `AimConsole`); this
// component only renders the rail/panel CONTENT and calls back the threaded
// `onExpand` / `onCollapse` — it never owns the open state.

import {
  issueStatusPills,
  type PillTone,
  prStatusPills,
  type StatusPill,
} from "@/components/producer-console/r-panel/status-pills";
import { useUnitIssues } from "@/hooks/useUnitIssues";
import { useUnitPrs } from "@/hooks/useUnitPrs";
import type {
  IssueSummaryWire,
  PrSummaryWire,
  RepoIssuesWire,
  RepoPrsWire,
  UnitRepoWire,
} from "@/lib/api";
import { cn } from "@/lib/utils";

interface PrRailProps {
  /** Focused unit — scopes both the PR and Issue hooks. `null` parks them
   *  (no fetch), mirroring the rest of the aim console. */
  unitName: string | null;
  /** Display label for the panel header (App's `metaUnit` — the focused
   *  unit, or the first configured unit when none is focused). */
  unitLabel: string;
  /** The focused unit's configured repos — drives the header's `· {N} repos`
   *  count. Empty for a cwd-synthesized unit (same convention as the S4
   *  bash footer's fallback). */
  repos: UnitRepoWire[];
  /** Whether the rail is expanded — drives `aria-expanded` on the collapsed
   *  rail button. The actual show/hide is the root's `.pr-open` display
   *  toggle (S1), untouched here. */
  open: boolean;
  /** The S1 mechanism's `setPrOpen(true)` (collapsed rail click) /
   *  `setPrOpen(false)` (✕), threaded in so the open state stays in
   *  `AimConsole`. */
  onExpand: () => void;
  onCollapse: () => void;
}

// Map a categorical pill tone to the mock's `.pst` colour modifier
// (green / amber / dim / violet, + a red fail variant for CI failure that
// the mock's open-only sample never showed). The tone→colour intent is the
// SAME categorical mapping `StatusPills` uses; only the token layer differs.
const PST_TONE_CLASS: Record<PillTone, string> = {
  ok: "o", // open / approved / CI pass → --green
  warn: "r", // review / changes requested / CI pending → --amber
  danger: "f", // CI fail → --danger
  info: "m", // merged → --violet
  muted: "d", // draft / closed → --dim
};

export function PrRail({ unitName, unitLabel, repos, open, onExpand, onCollapse }: PrRailProps) {
  // One poll each, feeding BOTH the collapsed counts and the expanded lists
  // (so the rail never double-polls). The endpoints are open-only + already
  // unit-scoped across every repo, so the totals are the live open counts.
  const { data: prData } = useUnitPrs(unitName);
  const { data: issueData } = useUnitIssues(unitName);

  const prRepos = prData?.repos ?? [];
  const issueRepos = issueData?.repos ?? [];
  const openPrCount = prRepos.reduce((n, r) => n + r.prs.length, 0);
  const openIssueCount = issueRepos.reduce((n, r) => n + r.issues.length, 0);

  return (
    <>
      {/* ── collapsed rail (live open-counts + static EXTERNAL framing) ── */}
      <button
        type="button"
        className="ac-prrail"
        onClick={onExpand}
        title="Expand PR / Issue rail"
        aria-label="Expand PR / Issue rail"
        aria-expanded={open}
      >
        {/* `.ac-v.w` keeps the amber dev-tool accent as a STATIC accent —
            it just shows the live open PR count. */}
        <span className="ac-v w">PR {openPrCount}</span>
        <span className="ac-v">Issue {openIssueCount}</span>
        <span className="ac-g">‹ EXTERNAL</span>
      </button>

      {/* ── expanded panel (per-repo PR + Issue inventory) ── */}
      <div className="ac-prfull">
        <div className="ac-prh">
          PR / ISSUE — unit {unitLabel} · {repos.length} repos
          <button
            type="button"
            className="ac-x"
            onClick={onCollapse}
            title="Collapse PR / Issue rail"
            aria-label="Collapse PR / Issue rail"
          >
            ✕
          </button>
        </div>
        <div className="ac-prb">
          <PrGroup repos={prRepos} count={openPrCount} />
          <IssueGroup repos={issueRepos} count={openIssueCount} />
        </div>
      </div>
    </>
  );
}

// "Pull Requests · N" — the unit's open PRs, gathered flat across every repo
// (primary first, then declaration order, as the endpoint returns them), each
// row tagged with its owning repo pill.
function PrGroup({ repos, count }: { repos: RepoPrsWire[]; count: number }) {
  return (
    <div className="ac-prg" data-testid="ac-pr-group">
      <h4>Pull Requests · {count}</h4>
      {count === 0 ? (
        <p className="ac-prempty">No open PRs.</p>
      ) : (
        repos.flatMap((repo) =>
          repo.prs.map((pr) => (
            <PrRow key={`${repo.repo_path}#${pr.number}`} pr={pr} repo={repo} />
          )),
        )
      )}
    </div>
  );
}

// "Issues · N" — same shape, the unit's open issues across every repo.
function IssueGroup({ repos, count }: { repos: RepoIssuesWire[]; count: number }) {
  return (
    <div className="ac-prg" data-testid="ac-issue-group">
      <h4>Issues · {count}</h4>
      {count === 0 ? (
        <p className="ac-prempty">No open issues.</p>
      ) : (
        repos.flatMap((repo) =>
          repo.issues.map((issue) => (
            <IssueRow key={`${repo.repo_path}#${issue.number}`} issue={issue} repo={repo} />
          )),
        )
      )}
    </div>
  );
}

function PrRow({ pr, repo }: { pr: PrSummaryWire; repo: RepoPrsWire }) {
  return (
    <Row
      repoLabel={repo.repo_label}
      primary={repo.primary}
      number={pr.number}
      title={pr.title}
      pills={prStatusPills(pr)}
    />
  );
}

function IssueRow({ issue, repo }: { issue: IssueSummaryWire; repo: RepoIssuesWire }) {
  return (
    <Row
      repoLabel={repo.repo_label}
      primary={repo.primary}
      number={issue.number}
      title={issue.title}
      pills={issueStatusPills(issue)}
    />
  );
}

// One inventory row (mock `.pi`): repo pill (primary highlighted) + `#number`
// (mono) + single-line ellipsised title + categorical status pill(s).
// Display-only — no click target (see file header).
function Row({
  repoLabel,
  primary,
  number,
  title,
  pills,
}: {
  repoLabel: string;
  primary: boolean;
  number: bigint;
  title: string;
  pills: StatusPill[];
}) {
  return (
    <div className="ac-pi" data-testid="ac-pi">
      <span
        className={cn("ac-repo", primary && "pri")}
        data-testid="ac-pi-repo"
        data-primary={primary ? "true" : "false"}
      >
        {repoLabel}
      </span>
      <span className="ac-pn">#{Number(number)}</span>
      <span className="ac-pt">{title}</span>
      <span className="ac-psts">
        {pills.map((p) => (
          <span
            key={p.key}
            className={cn("ac-pst", PST_TONE_CLASS[p.tone])}
            data-testid="ac-status-pill"
            data-tone={p.tone}
          >
            {p.label}
          </span>
        ))}
      </span>
    </div>
  );
}
