// PR / Issue status pills + the EXTERNAL-source framing badge — the R₁
// inventory's Stage-C shells (aim-console destination convergence,
// tmai-core `doc/approaches/2026-06-09-aim-console-destination-convergence.md`
// Stage C; mock `origin/mock/aim-ui-sample` PR rail = colour-coded `.pst`
// pills + an EXTERNAL framing).
//
// WHY colour HERE when the R₁ header comments say "no severity colour":
// these pills are CATEGORICAL, not appraisal. The colour names *which*
// lifecycle state a PR/Issue is in (open / merged / draft / under review /
// CI state) — it is a fact rendered glanceable, the same way the diff
// viewer's +/- red/green is the diff fact's conventional representation,
// NOT a tmai-side ranking of urgency/importance. The earlier R₁ posture
// (`2026-05-26-tmai-states-facts-not-appraisals`) forbids *severity /
// priority / relevance* tinting; Stage C's destination mock deliberately
// renders lifecycle state in categorical colour, so the operator can scan
// the inventory's shape without opening each R₂ viewer (where these facts
// used to live only). The operator-authored attention heat (the
// `RowAttentionMarker`) stays a separate, orthogonal axis.

import type { IssueSummaryWire, PrSummaryWire } from "@/lib/api";
import { cn } from "@/lib/utils";

// Tone = colour-intent, NOT the state word — so two different states that
// share a colour (e.g. `open` and `approved`, both `ok`) reuse one class.
export type PillTone = "ok" | "warn" | "danger" | "info" | "muted";

// Semantic theme tokens only (the repo-wide `no-raw-palette` lock forbids
// raw Tailwind palette families). `accent` is the themed violet — the mock's
// merged colour; `success`/`warning`/`destructive` are the themed
// green/amber/red; `muted` (draft/closed) is the quiet dim pill.
const TONE_CLASS: Record<PillTone, string> = {
  ok: "border-success/30 bg-success/10 text-success",
  warn: "border-warning/30 bg-warning/10 text-warning",
  danger: "border-destructive/30 bg-destructive/10 text-destructive",
  info: "border-accent/30 bg-accent/10 text-accent",
  muted: "border-hairline-strong/40 text-subtle-foreground",
};

export interface StatusPill {
  /** Stable React key within one row's pill set (one per category). */
  key: string;
  label: string;
  tone: PillTone;
}

// `review_decision` is the raw uppercased `gh` string
// (`APPROVED` / `CHANGES_REQUESTED` / `REVIEW_REQUIRED`) — see
// `PrSummaryWire`'s header comment. Map the common cases to short labels;
// fall back to a lowercased passthrough for any value `gh` adds later.
function reviewPill(decision: string): StatusPill {
  switch (decision.toUpperCase()) {
    case "APPROVED":
      return { key: "review", label: "approved", tone: "ok" };
    case "CHANGES_REQUESTED":
      return { key: "review", label: "changes requested", tone: "warn" };
    case "REVIEW_REQUIRED":
      return { key: "review", label: "review", tone: "warn" };
    default:
      return { key: "review", label: decision.toLowerCase().replace(/_/g, " "), tone: "muted" };
  }
}

// `check_status` is the raw rolled-up `gh` string (`SUCCESS` / `FAILURE` /
// `PENDING`); same passthrough discipline as `reviewPill`.
function ciPill(checkStatus: string): StatusPill {
  switch (checkStatus.toUpperCase()) {
    case "SUCCESS":
      return { key: "ci", label: "CI pass", tone: "ok" };
    case "FAILURE":
      return { key: "ci", label: "CI fail", tone: "danger" };
    case "PENDING":
      return { key: "ci", label: "CI pending", tone: "warn" };
    default:
      return { key: "ci", label: `CI ${checkStatus.toLowerCase()}`, tone: "muted" };
  }
}

// One PR row's pills: exactly one lifecycle pill (draft / merged / closed /
// open), plus a review pill and a CI pill when those fields are present.
// Derived purely from fields already on the wire (`state` / `is_draft` /
// `merge_commit_sha` / `review_decision` / `check_status`).
export function prStatusPills(pr: PrSummaryWire): StatusPill[] {
  const pills: StatusPill[] = [];
  const state = pr.state.toUpperCase();
  if (pr.is_draft) {
    pills.push({ key: "lifecycle", label: "draft", tone: "muted" });
  } else if (state === "MERGED" || pr.merge_commit_sha !== null) {
    pills.push({ key: "lifecycle", label: "merged", tone: "info" });
  } else if (state === "CLOSED") {
    pills.push({ key: "lifecycle", label: "closed", tone: "muted" });
  } else {
    pills.push({ key: "lifecycle", label: "open", tone: "ok" });
  }
  if (pr.review_decision !== null) {
    pills.push(reviewPill(pr.review_decision));
  }
  if (pr.check_status !== null) {
    pills.push(ciPill(pr.check_status));
  }
  return pills;
}

// One Issue row's pills: a single lifecycle pill from `state`. The
// unit-scoped issue list is open-only in practice, but `closed` is handled
// for shape parity. Labels stay plain text in the row (not pills).
export function issueStatusPills(issue: IssueSummaryWire): StatusPill[] {
  return issue.state.toLowerCase() === "closed"
    ? [{ key: "lifecycle", label: "closed", tone: "muted" }]
    : [{ key: "lifecycle", label: "open", tone: "ok" }];
}

export function StatusPills({ pills }: { pills: StatusPill[] }) {
  if (pills.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {pills.map((p) => (
        <span
          key={p.key}
          data-testid="status-pill"
          data-tone={p.tone}
          className={cn(
            "inline-flex items-center rounded border px-1.5 font-mono text-[10px] leading-relaxed",
            TONE_CLASS[p.tone],
          )}
        >
          {p.label}
        </span>
      ))}
    </span>
  );
}

// "EXTERNAL · github = source of truth" framing for the PR / Issue rail
// headers (C2). PRs and Issues are the GitHub-resident artifacts on the R
// panel (vs the git-resident decisions / approaches / aims), so this tag
// states that github — not tmai — is their source of truth. Subtle / mono,
// pushed to the right edge of the section header.
export function ExternalSourceBadge() {
  return (
    <span
      data-testid="external-source-badge"
      title="github = source of truth"
      className="ml-auto inline-flex items-center rounded border border-hairline-strong/40 px-1.5 font-mono text-[9px] uppercase tracking-wide text-subtle-foreground"
    >
      EXTERNAL · github
    </span>
  );
}
