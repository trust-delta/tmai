// Remote-Δ freshness — pure helpers (#822; design: tmai-core
// `docs/archive/slack/2026-06-12-161334.md` §3, aim `pr-issue-ci`,
// anchor 「リモートに変化があった場合、未観測の事実として表示する」).
//
// A row is UNOBSERVED when its newest vocab event timestamp is newer than
// the operator's effective close-act cursor for that section. The vocab is
// deliberately conservative (flood control, inherited from the old
// fingerprint.rs judgement): PR created / merged / closed / CI conclusion;
// issue created / closed. Label / assignee churn is NOT a vocab event.
//
// This is a freshness instrument, not a confirmation ledger — see the
// `RemoteDeltaCursor` doc in ui-prefs.ts for the load-bearing exclusions
// (client-state only, never sent to core, exactly two advance acts, no
// read-marking / mute, no cross-unit accent until a second unit exists).

import type { IssueSummaryWire, PrSummaryWire, RepoIssuesWire, RepoPrsWire } from "@/lib/api";
import type { RemoteDeltaCursor } from "@/lib/ui-prefs";

export type CursorSection = "prs" | "issues";
export type CursorKey = "panel" | CursorSection;

// Max of parseable ISO timestamps; unparseable / null entries are skipped
// (a malformed wire timestamp must not poison the whole row's verdict).
function maxIso(values: ReadonlyArray<string | null | undefined>): string | null {
  let best: string | null = null;
  let bestMs = Number.NEGATIVE_INFINITY;
  for (const v of values) {
    if (typeof v !== "string") continue;
    const ms = Date.parse(v);
    if (Number.isNaN(ms)) continue;
    if (ms > bestMs) {
      bestMs = ms;
      best = v;
    }
  }
  return best;
}

// The effective cursor for a section = MAX(unit panel cursor, section
// cursor): closing the whole panel counts as having stopped looking at
// every section in it. `null` = no close act recorded yet (first run).
export function effectiveCursor(
  cursors: Record<string, RemoteDeltaCursor>,
  unit: string,
  section: CursorSection,
): string | null {
  const c = cursors[unit];
  if (c === undefined) return null;
  return maxIso([c.panel, c[section]]);
}

// A row's vocab timestamp = max of its non-null vocab event timestamps.
// `null` when the payload carries none (older wire) — such a row can never
// claim to be newer than a cursor.
export function prVocabTimestamp(pr: PrSummaryWire): string | null {
  return maxIso([pr.created_at, pr.merged_at, pr.closed_at, pr.ci_completed_at]);
}

export function issueVocabTimestamp(issue: IssueSummaryWire): string | null {
  return maxIso([issue.created_at, issue.closed_at]);
}

// UNOBSERVED = vocab_ts is strictly newer than the effective cursor.
// No cursor yet (first run) → every row is unobserved — the honest
// 「一度も見ていない」; it self-clears on the first collapse act.
export function isUnobserved(vocabTs: string | null, cursor: string | null): boolean {
  if (cursor === null) return true;
  if (vocabTs === null) return false;
  return Date.parse(vocabTs) > Date.parse(cursor);
}

// Immutable cursor advance for one of the act kinds that all reduce to the
// same "operator stopped looking" stamp: the R panel collapse (`panel`), a
// section collapse (`prs` / `issues`), and — for the cross-unit tab dot
// (`cross-unit-remote-delta`) — switching focus AWAY from a unit's tab, which
// stamps that unit's `panel` cursor (App's tab-leave effect). All three are
// EXPLICIT operator acts; nothing implicit may call this — no visibilitychange,
// no scroll, no per-row marking, no timers (operator-ratified exclusion list).
export function advanceCursor(
  cursors: Record<string, RemoteDeltaCursor>,
  unit: string,
  key: CursorKey,
  nowIso: string,
): Record<string, RemoteDeltaCursor> {
  return { ...cursors, [unit]: { ...cursors[unit], [key]: nowIso } };
}

// Within-unit unobserved counts (collapsed section header / collapsed rail).
// Counts stay within-unit only — the cross-unit tab accent is deferred
// until a second unit exists, and even then carries presence, not a count.
export function unobservedPrCount(repos: RepoPrsWire[] | null, cursor: string | null): number {
  if (repos === null) return 0;
  return repos.reduce(
    (n, r) => n + r.prs.filter((pr) => isUnobserved(prVocabTimestamp(pr), cursor)).length,
    0,
  );
}

export function unobservedIssueCount(
  repos: RepoIssuesWire[] | null,
  cursor: string | null,
): number {
  if (repos === null) return 0;
  return repos.reduce(
    (n, r) => n + r.issues.filter((i) => isUnobserved(issueVocabTimestamp(i), cursor)).length,
    0,
  );
}

// One unit's raw remote-Δ slices as fanned out by `useCrossUnitRemoteDelta`
// (aim `cross-unit-remote-delta`). `null` = that section's fetch failed this
// cycle (the hook keeps the prior dot); an empty `repos[]` = the unit genuinely
// has none.
export interface UnitRemoteDelta {
  prs: RepoPrsWire[] | null;
  issues: RepoIssuesWire[] | null;
}

// Every live unit's slices, keyed by unit name.
export type CrossUnitRemoteDelta = Record<string, UnitRemoteDelta>;

// Does this unit have ANY unobserved PR or issue? The cross-unit tab signal
// collapses the within-unit counts to a single presence BIT — the tab accent
// carries freshness presence, never a count (the header note's cross-unit
// rule). `undefined` delta (not yet fanned out) is not-fresh; a `null` cursor
// (never looked at this tab) makes every row unobserved — the honest
// 「一度も見ていない」, which self-clears on the first tab-leave / panel close.
export function unitHasUnobserved(
  delta: UnitRemoteDelta | undefined,
  cursors: Record<string, RemoteDeltaCursor>,
  unit: string,
): boolean {
  if (delta === undefined) return false;
  return (
    unobservedPrCount(delta.prs, effectiveCursor(cursors, unit, "prs")) > 0 ||
    unobservedIssueCount(delta.issues, effectiveCursor(cursors, unit, "issues")) > 0
  );
}
