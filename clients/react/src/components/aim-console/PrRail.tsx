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
//
// REMOTE-Δ FRESHNESS (#606 §1 / aim `pr-issue-ci` / instrument #822): the
// remote-Δ instrument used to live ONLY in the producer-console R panel
// (`RPrsSection` / `RIssuesSection`), so the aim-console — the DEFAULT surface
// since #850/#851 — showed PR/issue rows but not "which changed since you last
// looked" (a stranding regression, the same shape as the #897/#898 handoff
// overlay lift). This rail now carries the instrument too. WHAT it reuses: the
// pure `remote-delta.ts` helpers (logic, no theme — same import category as the
// `prStatusPills` derivation). WHAT it does NOT reuse: the producer-console
// `UnobservedDelta` component, because it carries the producer theme's
// `text-info` token; the dev-tool Δ accent is its own `.ac-unobs` (cyan = the
// aim-console info-family token), keeping the #801 bounding (touch ONLY
// `aim-console/**` + `aim-console.css`). The cursor itself is OWNED by
// `AimConsole` (the rail-collapse close act stamps the unit's `panel` cursor in
// the SHARED `remoteDeltaCursors` ui-pref — looking via either console is one
// human looking-act, so the cursor is mode-independent); this component is
// presentational and only receives the effective cursors as props. The Δ is an
// info-tone freshness FACT ("changed since 見ていた"), never the owed amber.

import {
  issueVocabTimestamp,
  isUnobserved,
  prVocabTimestamp,
  unobservedIssueCount,
  unobservedPrCount,
} from "@/components/producer-console/r-panel/remote-delta";
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
  /** Whether the Remote panel is expanded — drives `aria-expanded` on the
   *  collapsed rail button. The actual show/hide + overlay/dock positioning is
   *  the root's `.remote-open` / `.remote-dock` classes (AimConsole), not here. */
  open: boolean;
  /** Whether the open panel is DOCKED (push, both panes visible) vs the default
   *  OVERLAY (floats over the Aim pane). Drives the dock-toggle pressed state. */
  docked?: boolean;
  /** `setRemoteOpen(true)` (collapsed rail click) / collapse (✕), threaded in so
   *  the open state stays in `AimConsole`. */
  onExpand: () => void;
  onCollapse: () => void;
  /** Toggle dock ⇄ overlay for the open panel (the ⊟ control). Absent in
   *  isolation renders → the control is not shown. */
  onToggleDock?: () => void;
  /** Remote-Δ effective cursor for the PRs / Issues sections (#822), each =
   *  MAX(unit panel close, that section's close), threaded from `AimConsole`
   *  (which owns the shared `remoteDeltaCursors` ui-pref). `null` = no close
   *  act recorded yet (first run → every row unobserved, the honest
   *  「一度も見ていない」); `undefined` = no freshness wiring at all (e.g.
   *  isolation tests / no focused unit), rows + rail render accent-free. */
  prsCursor?: string | null;
  issuesCursor?: string | null;
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

export function PrRail({
  unitName,
  unitLabel,
  repos,
  open,
  docked,
  onExpand,
  onCollapse,
  onToggleDock,
  prsCursor,
  issuesCursor,
}: PrRailProps) {
  // One poll each, feeding BOTH the collapsed counts and the expanded lists
  // (so the rail never double-polls). The endpoints are open-only + already
  // unit-scoped across every repo, so the totals are the live open counts.
  const { data: prData } = useUnitPrs(unitName);
  const { data: issueData } = useUnitIssues(unitName);

  const prRepos = prData?.repos ?? [];
  const issueRepos = issueData?.repos ?? [];
  const openPrCount = prRepos.reduce((n, r) => n + r.prs.length, 0);
  const openIssueCount = issueRepos.reduce((n, r) => n + r.issues.length, 0);

  // Remote-Δ unobserved totals (#822). `undefined` cursor = no freshness wiring
  // (isolation / no focused unit) → 0, so the rail renders accent-free exactly
  // as before. `null` cursor (first run, no close act yet) → the helpers treat
  // every row as unobserved. The collapsed rail shows the unit total so the
  // operator sees "something changed" WITHOUT expanding — the whole point of a
  // freshness instrument on a default-collapsed rail.
  const unobservedTotal =
    (prsCursor === undefined ? 0 : unobservedPrCount(prRepos, prsCursor)) +
    (issuesCursor === undefined ? 0 : unobservedIssueCount(issueRepos, issuesCursor));

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
        {/* Remote-Δ unit total: unobserved PR + issue rows since the close act.
            Within-unit count only — info-tone (cyan) freshness fact, never the
            owed amber; no cross-unit accent (deferred until a second unit). */}
        {unobservedTotal > 0 && (
          <span
            className="ac-v dl"
            data-testid="ac-rail-unobserved"
            title={`${unobservedTotal} unobserved remote ${unobservedTotal === 1 ? "change" : "changes"} since you last looked`}
          >
            Δ {unobservedTotal}
          </span>
        )}
        <span className="ac-g">‹ EXTERNAL</span>
      </button>

      {/* ── expanded panel (per-repo PR + Issue inventory) ── */}
      <div className="ac-prfull">
        <div className="ac-prh">
          {/* Dock ⇄ float toggle at the TOP-LEFT (⊟ overlay → ⊞ docked). */}
          {onToggleDock !== undefined && (
            <button
              type="button"
              className={cn("ac-prdock", docked && "on")}
              onClick={onToggleDock}
              aria-pressed={docked === true}
              title={
                docked
                  ? "Float — overlay the Remote panel over the Aim pane"
                  : "Dock — push the Aim pane aside so both stay visible"
              }
              aria-label={docked ? "Float the Remote panel (overlay)" : "Dock the Remote panel"}
            >
              {docked ? "⊞" : "⊟"}
            </button>
          )}
          <span className="ac-prh-title">
            PR / ISSUE — unit {unitLabel} · {repos.length} repos
          </span>
          {/* Explicit close ONLY when docked — the overlay closes by clicking
              outside it (AimConsole), so it carries no ✕. */}
          {docked === true && (
            <button
              type="button"
              className="ac-x"
              onClick={onCollapse}
              title="Collapse PR / Issue rail"
              aria-label="Collapse PR / Issue rail"
            >
              ✕
            </button>
          )}
        </div>
        <div className="ac-prb">
          <PrGroup repos={prRepos} count={openPrCount} cursor={prsCursor} />
          <IssueGroup repos={issueRepos} count={openIssueCount} cursor={issuesCursor} />
        </div>
      </div>
    </>
  );
}

// "Pull Requests · N" — the unit's open PRs, gathered flat across every repo
// (primary first, then declaration order, as the endpoint returns them), each
// row tagged with its owning repo pill. `cursor` threads the remote-Δ freshness
// down to each row (undefined ⇒ accent-free).
function PrGroup({
  repos,
  count,
  cursor,
}: {
  repos: RepoPrsWire[];
  count: number;
  cursor?: string | null;
}) {
  return (
    <div className="ac-prg" data-testid="ac-pr-group">
      <h4>Pull Requests · {count}</h4>
      {count === 0 ? (
        <p className="ac-prempty">No open PRs.</p>
      ) : (
        repos.flatMap((repo) =>
          repo.prs.map((pr) => (
            <PrRow key={`${repo.repo_path}#${pr.number}`} pr={pr} repo={repo} cursor={cursor} />
          )),
        )
      )}
    </div>
  );
}

// "Issues · N" — same shape, the unit's open issues across every repo.
function IssueGroup({
  repos,
  count,
  cursor,
}: {
  repos: RepoIssuesWire[];
  count: number;
  cursor?: string | null;
}) {
  return (
    <div className="ac-prg" data-testid="ac-issue-group">
      <h4>Issues · {count}</h4>
      {count === 0 ? (
        <p className="ac-prempty">No open issues.</p>
      ) : (
        repos.flatMap((repo) =>
          repo.issues.map((issue) => (
            <IssueRow
              key={`${repo.repo_path}#${issue.number}`}
              issue={issue}
              repo={repo}
              cursor={cursor}
            />
          )),
        )
      )}
    </div>
  );
}

function PrRow({
  pr,
  repo,
  cursor,
}: {
  pr: PrSummaryWire;
  repo: RepoPrsWire;
  cursor?: string | null;
}) {
  return (
    <Row
      repoLabel={repo.repo_label}
      primary={repo.primary}
      number={pr.number}
      title={pr.title}
      pills={prStatusPills(pr)}
      unobserved={cursor !== undefined && isUnobserved(prVocabTimestamp(pr), cursor)}
    />
  );
}

function IssueRow({
  issue,
  repo,
  cursor,
}: {
  issue: IssueSummaryWire;
  repo: RepoIssuesWire;
  cursor?: string | null;
}) {
  return (
    <Row
      repoLabel={repo.repo_label}
      primary={repo.primary}
      number={issue.number}
      title={issue.title}
      pills={issueStatusPills(issue)}
      unobserved={cursor !== undefined && isUnobserved(issueVocabTimestamp(issue), cursor)}
    />
  );
}

// One inventory row (mock `.pi`): an optional leading remote-Δ accent + repo
// pill (primary highlighted) + `#number` (mono) + single-line ellipsised title
// + categorical status pill(s). Display-only — no click target (see header).
function Row({
  repoLabel,
  primary,
  number,
  title,
  pills,
  unobserved,
}: {
  repoLabel: string;
  primary: boolean;
  number: bigint;
  title: string;
  pills: StatusPill[];
  unobserved?: boolean;
}) {
  return (
    <div className="ac-pi" data-testid="ac-pi">
      {/* Remote-Δ accent (#822): leading Δ when this row's vocab ts is newer
          than the close-act cursor. Observed rows render no counterpart at all
          — observed is the unmarked default, not a second badge. */}
      {unobserved === true && (
        <span
          className="ac-unobs"
          data-testid="ac-unobserved"
          title="unobserved — changed since you last looked"
        >
          Δ
        </span>
      )}
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
