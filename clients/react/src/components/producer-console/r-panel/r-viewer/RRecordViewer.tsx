// R₂ — the in-tmai record content viewer, shared base across BOTH record
// kinds (⬡ decision / ▣ approach). Serves the spine
// `2026-05-29-c-and-r-as-the-development-substrate` (the per-kind walk's
// "(ii) judgment-info" surface) + `2026-05-29-artifact-content-viewer`
// (γ-lean R₂ viewer) + `2026-05-16-dev-loop-completes-in-tmai` (read the
// project's records in-tmai, no editor round-trip).
//
// Mirrors `RPrViewer`'s posture exactly: an INDEPENDENT right-side column
// that NEVER auto-opens — it mounts only on an explicit operator row
// click in the R₁ inventory (the parent gates the mount on a non-null
// `selectedRecord`). R₁ (`RDecisionsSection` / `RApproachesSection`)
// stays a pure inventory; this column renders the clicked record's
// content.
//
// SCOPE — read-only, excerpt-level, NO actions. This is the (ii)
// judgment-info viewer only: it renders the rich frontmatter + the
// `excerpt` the wire already carries. The full markdown body + Update
// history live behind a deferred tmai-core content endpoint and are NOT
// fetched here. The (iii) lifecycle acts (accept / verdict / amend /
// archive / bump) need an unbuilt R-lifecycle backend and are explicitly
// deferred — the viewer mutates nothing.
//
// Negative space (the serving `2026-05-26-tmai-states-facts-not-appraisals`
// posture — tmai states facts, never appraises):
//   - all record facts (frontmatter, drift, review triggers, signals)
//     stay PLAIN inline — `text-foreground` / `text-muted-foreground` /
//     `text-subtle-foreground` only, never warning / destructive /
//     success accents;
//   - the drift + review-trigger indicators are PLAIN facts, not alarms
//     (silence-is-not-neutral: a present drift / a ready trigger is shown
//     plainly; their absence shows nothing — no "all clear" reassurance,
//     no "changed since you last looked" / unread / TL;DR / auto-summary);
//   - the ONE allowed convention is standard markdown rendering inside
//     the excerpt (via `PROSE_CLASSES`), same as `RPrViewer`'s body.

import { useMemo } from "react";
import Markdown, { type Components, defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useApproaches } from "@/hooks/useApproaches";
import { useDecisions } from "@/hooks/useDecisions";
import type {
  ApproachesResponse,
  ApproachWire,
  DecisionsResponse,
  DecisionWire,
  ReviewTriggerWire,
} from "@/lib/api";
import { PROSE_CLASSES } from "./prose";

// What R₁ hands R₂ on a record row click. The full wire object rides
// along (like `SelectedPr` carries the full `pr`) so the viewer renders
// every fact without re-fetching; `repoPath` / `repoLabel` mirror the PR
// selection so the header reads identically. A discriminated union on
// `kind` keeps the two record shapes honest at the type level.
export type SelectedRecord =
  | { kind: "decision"; repoPath: string; repoLabel: string; record: DecisionWire }
  | { kind: "approach"; repoPath: string; repoLabel: string; record: ApproachWire };

export function selectedRecordKey(repoPath: string, slug: string): string {
  return `${repoPath}#${slug}`;
}

interface RRecordViewerProps {
  selected: SelectedRecord;
  /** Unit whose decisions + approaches feed cross-ref resolution. The
   *  viewer re-fetches both sets (cheap 60s polls, same hooks R₁ uses) so
   *  a clicked slug can be resolved to whichever kind owns it. The
   *  focused record itself rides in `selected` and needs no fetch. */
  unitName: string | null;
  /** Re-focus R₂ on a cross-referenced record (stays in this column). */
  onSelectRecord: (sel: SelectedRecord) => void;
  onClose: () => void;
}

export function RRecordViewer({ selected, unitName, onSelectRecord, onClose }: RRecordViewerProps) {
  // Both sets back the cross-ref index: a clicked slug is resolved against
  // decisions AND approaches and focuses whichever kind matches.
  const { data: decisions } = useDecisions(unitName);
  const { data: approaches } = useApproaches(unitName);
  const index = useMemo(() => buildRecordIndex(decisions, approaches), [decisions, approaches]);

  return (
    <aside
      data-testid="r-record-viewer"
      className="glass flex w-[clamp(22rem,40vw,48rem)] shrink-0 flex-col border-l border-hairline"
    >
      <ViewerHeader selected={selected} onClose={onClose} />
      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3 text-xs">
        <FrontmatterTable selected={selected} index={index} onSelectRecord={onSelectRecord} />
        {selected.kind === "decision" ? (
          <DriftIndicator decision={selected.record} />
        ) : (
          <ReviewTriggerIndicator approach={selected.record} />
        )}
        {selected.kind === "approach" && <SignalsHoist approach={selected.record} />}
        <ExcerptSection
          excerpt={selected.record.excerpt}
          index={index}
          onSelectRecord={onSelectRecord}
        />
      </div>
    </aside>
  );
}

// ── Cross-ref index — slug → the SelectedRecord that owns it ──
//
// Decisions are indexed first so a slug colliding across kinds (rare —
// the two live in different directories) resolves to the decision. A
// slug absent from the index is a not-yet-existing ref, rendered plain.

function flattenDecisions(decisions: DecisionsResponse | null): {
  repoPath: string;
  repoLabel: string;
  record: DecisionWire;
}[] {
  if (decisions === null) return [];
  return decisions.repos.flatMap((repo) =>
    [...repo.foundations, ...repo.in_play, ...repo.warm, ...repo.cold, ...repo.superseded].map(
      (record) => ({ repoPath: repo.repo_root, repoLabel: repo.repo_label, record }),
    ),
  );
}

function flattenApproaches(approaches: ApproachesResponse | null): {
  repoPath: string;
  repoLabel: string;
  record: ApproachWire;
}[] {
  if (approaches === null) return [];
  return approaches.repos.flatMap((repo) =>
    repo.approaches.map((record) => ({
      repoPath: repo.repo_root,
      repoLabel: repo.repo_label,
      record,
    })),
  );
}

function buildRecordIndex(
  decisions: DecisionsResponse | null,
  approaches: ApproachesResponse | null,
): Map<string, SelectedRecord> {
  const index = new Map<string, SelectedRecord>();
  for (const { repoPath, repoLabel, record } of flattenDecisions(decisions)) {
    if (!index.has(record.slug)) {
      index.set(record.slug, { kind: "decision", repoPath, repoLabel, record });
    }
  }
  for (const { repoPath, repoLabel, record } of flattenApproaches(approaches)) {
    if (!index.has(record.slug)) {
      index.set(record.slug, { kind: "approach", repoPath, repoLabel, record });
    }
  }
  return index;
}

// ── Header — mechanical identity facts, all plain (no severity tint) ──

function ViewerHeader({ selected, onClose }: { selected: SelectedRecord; onClose: () => void }) {
  const { repoLabel, record } = selected;
  // Decision: kind-fact = category. Approach: kind-fact = creation date.
  const kindFact = selected.kind === "decision" ? selected.record.category : selected.record.date;
  return (
    <header className="shrink-0 border-b border-hairline px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-subtle-foreground">
            {repoLabel} · {selected.kind}
          </p>
          <h2 className="text-sm font-semibold text-foreground">{record.title}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          title="Close record viewer"
          aria-label="Close record viewer"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-strong hover:text-foreground"
        >
          ×
        </button>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-subtle-foreground">
        <span className="font-mono">{record.slug}</span>
        <span className="text-muted-foreground">{record.status}</span>
        <span className="text-muted-foreground">{kindFact}</span>
      </div>
    </header>
  );
}

// ── Section frame (mirrors RPrViewer's plain section heading) ──

function SectionFrame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-subtle-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

// ── Frontmatter table — plain `dl` of mechanical facts, no tint ──
//
// Slug-valued rows (serves / superseded_by / strengthened_by /
// replaced_by) render their entries as cross-refs; `governs[]` entries
// are PATHS, not slugs, so they are always plain, never clickable.

type FrontmatterRow =
  | { label: string; kind: "scalar"; value: string }
  | { label: string; kind: "paths"; values: string[] }
  | { label: string; kind: "slugs"; values: string[] };

function decisionRows(d: DecisionWire): FrontmatterRow[] {
  return [
    { label: "category", kind: "scalar", value: d.category },
    { label: "contract_surface", kind: "scalar", value: d.contract_surface ? "true" : "false" },
    { label: "governs", kind: "paths", values: d.governs },
    { label: "superseded_by", kind: "slugs", values: d.superseded_by },
    { label: "strengthened_by", kind: "slugs", values: d.strengthened_by },
  ];
}

function approachRows(a: ApproachWire): FrontmatterRow[] {
  return [
    { label: "serves", kind: "slugs", values: a.serves },
    { label: "governs", kind: "paths", values: a.governs },
    { label: "confidence", kind: "scalar", value: a.confidence ?? "—" },
    { label: "replaced_by", kind: "slugs", values: a.replaced_by },
  ];
}

function FrontmatterTable({
  selected,
  index,
  onSelectRecord,
}: {
  selected: SelectedRecord;
  index: Map<string, SelectedRecord>;
  onSelectRecord: (sel: SelectedRecord) => void;
}) {
  const rows =
    selected.kind === "decision" ? decisionRows(selected.record) : approachRows(selected.record);
  return (
    <SectionFrame title="Frontmatter">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {rows.map((row) => (
          <div key={row.label} className="contents">
            <dt className="text-subtle-foreground">{row.label}</dt>
            <dd className="text-foreground">
              <FrontmatterValue row={row} index={index} onSelectRecord={onSelectRecord} />
            </dd>
          </div>
        ))}
      </dl>
    </SectionFrame>
  );
}

function FrontmatterValue({
  row,
  index,
  onSelectRecord,
}: {
  row: FrontmatterRow;
  index: Map<string, SelectedRecord>;
  onSelectRecord: (sel: SelectedRecord) => void;
}) {
  if (row.kind === "scalar") {
    return <span className="font-mono">{row.value}</span>;
  }
  if (row.values.length === 0) {
    return <span className="text-subtle-foreground">—</span>;
  }
  if (row.kind === "paths") {
    return (
      <ul className="space-y-0.5">
        {row.values.map((path) => (
          <li key={path} className="font-mono text-foreground">
            {path}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-0.5">
      {row.values.map((slug) => (
        <li key={slug}>
          <CrossRef slug={slug} index={index} onSelectRecord={onSelectRecord} />
        </li>
      ))}
    </ul>
  );
}

// ── Cross-ref — a slug that resolves to a loaded record is clickable ──
//
// Plain styling (no severity / info tint): a dotted underline marks it as
// interactive without appraising it. An unresolved slug (a record that
// doesn't exist yet) is NOT an error — it renders as plain, non-clickable
// text.

function CrossRef({
  slug,
  index,
  onSelectRecord,
}: {
  slug: string;
  index: Map<string, SelectedRecord>;
  onSelectRecord: (sel: SelectedRecord) => void;
}) {
  const target = index.get(slug);
  if (target === undefined) {
    return <span className="font-mono text-muted-foreground">{slug}</span>;
  }
  return (
    <button
      type="button"
      onClick={() => onSelectRecord(target)}
      className="rounded font-mono text-foreground underline decoration-dotted underline-offset-2 transition-colors hover:bg-surface-strong/40"
    >
      {slug}
    </button>
  );
}

// ── Drift indicator (decision) — PLAIN fact, never an alarm ──

function DriftIndicator({ decision }: { decision: DecisionWire }) {
  const stale = decision.stale_since;
  // Absent when no drift: a clean decision shows nothing here (no "all
  // clear" reassurance). Present drift is a plain fact, not a warning.
  if (stale === null) return null;
  return (
    <SectionFrame title="Drift">
      <p className="text-muted-foreground">
        <span className="font-mono text-foreground">{stale.path}</span> changed {stale.change_date}{" "}
        after last-verified {decision.last_verified}
        {stale.change_subject !== "" && (
          <span className="text-subtle-foreground"> — {stale.change_subject}</span>
        )}
      </p>
    </SectionFrame>
  );
}

// ── Review-trigger indicator (approach) — PLAIN facts, never alarms ──
//
// Every trigger is listed plainly. A date-kind trigger whose date is on
// or before today is annotated "(review-trigger ready: <date>)" — the one
// thing tmai CAN auto-detect from a date. The non-date triggers
// (pr-closed / pr-merged / issue-closed / *-status / manual) are listed
// without a fired/not-fired claim, because tmai cannot auto-detect their
// firing.

// `YYYY-MM-DD` for today (UTC day boundary is immaterial for this plain
// fact). ISO date strings compare correctly lexicographically.
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatTrigger(t: ReviewTriggerWire): string {
  switch (t.kind) {
    case "date":
      return `review-after ${t.value}`;
    case "pr-closed":
      return `pr-closed ${t.ref}`;
    case "pr-merged":
      return `pr-merged ${t.ref}`;
    case "issue-closed":
      return `issue-closed ${t.ref}`;
    case "decision-status":
      return `decision-status ${t.ref} → ${t["target-status"]}`;
    case "approach-status":
      return `approach-status ${t.ref} → ${t["target-status"]}`;
    case "manual":
      return `manual: ${t.description}`;
  }
}

function ReviewTriggerIndicator({ approach }: { approach: ApproachWire }) {
  const today = todayIso();
  return (
    <SectionFrame title="Review triggers">
      <ul className="space-y-0.5">
        {approach.review_triggers.map((t) => {
          // The formatted line is the natural stable key — it encodes the
          // trigger's kind + ref/value, and triggers are parse-validated
          // (no exact duplicates within a record).
          const text = formatTrigger(t);
          const ready = t.kind === "date" && t.value <= today;
          return (
            <li key={text} className="text-foreground">
              <span className="font-mono text-muted-foreground">{text}</span>
              {ready && t.kind === "date" && (
                <span className="text-foreground"> (review-trigger ready: {t.value})</span>
              )}
            </li>
          );
        })}
      </ul>
    </SectionFrame>
  );
}

// ── Approach signal hoist — success / failure signal, prominent + plain ──
//
// These are the verdict material (does the approach's bet pay off?), so
// the viewer hoists them out of the body into labelled blocks. Plain —
// they state the bet, they don't appraise it.

function SignalsHoist({ approach }: { approach: ApproachWire }) {
  return (
    <div className="space-y-2">
      <SectionFrame title="Success signal">
        <p className="text-foreground">{approach.success_signal}</p>
      </SectionFrame>
      <SectionFrame title="Failure signal">
        <p className="text-foreground">{approach.failure_signal}</p>
      </SectionFrame>
    </div>
  );
}

// ── Excerpt — markdown via the shared PROSE_CLASSES, with `[[slug]]`
//    cross-refs ──
//
// The wire carries an `excerpt` (decision: the `## Decision` section for
// in-play, else a one-paragraph summary; approach: the first paragraph),
// NOT the full body. `[[slug]]` wiki-links in the excerpt are rewritten
// to markdown links with a `record:` scheme; the `a` override turns
// resolved ones into in-prose cross-ref buttons and leaves unresolved
// slugs as plain text.

const WIKILINK = /\[\[([^[\]]+)\]\]/g;

function ExcerptSection({
  excerpt,
  index,
  onSelectRecord,
}: {
  excerpt: string;
  index: Map<string, SelectedRecord>;
  onSelectRecord: (sel: SelectedRecord) => void;
}) {
  const trimmed = excerpt.trim();
  const withLinks = useMemo(
    () => trimmed.replace(WIKILINK, (_m, slug: string) => `[${slug}](record:${slug})`),
    [trimmed],
  );
  const components = useMemo<Components>(
    () => ({
      a({ href, children }) {
        if (href?.startsWith("record:")) {
          const slug = href.slice("record:".length);
          const target = index.get(slug);
          if (target === undefined) {
            // A not-yet-existing ref is not an error — plain text.
            return <span className="text-muted-foreground">{children}</span>;
          }
          return (
            <button
              type="button"
              onClick={() => onSelectRecord(target)}
              className="font-mono text-foreground underline decoration-dotted underline-offset-2 hover:decoration-solid"
            >
              {children}
            </button>
          );
        }
        // Real links keep the standard prose link rendering.
        return <a href={href}>{children}</a>;
      },
    }),
    [index, onSelectRecord],
  );

  return (
    <SectionFrame title="Excerpt">
      {trimmed === "" ? (
        <p className="text-subtle-foreground">No excerpt.</p>
      ) : (
        <div className={PROSE_CLASSES}>
          <Markdown
            remarkPlugins={[remarkGfm]}
            // Preserve the synthetic `record:` scheme; sanitize everything
            // else exactly as react-markdown would by default.
            urlTransform={(url) => (url.startsWith("record:") ? url : defaultUrlTransform(url))}
            components={components}
          >
            {withLinks}
          </Markdown>
        </div>
      )}
    </SectionFrame>
  );
}
