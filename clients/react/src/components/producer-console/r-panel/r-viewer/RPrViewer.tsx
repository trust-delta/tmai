// R₂ — the in-tmai PR content viewer (#749).
//
// γ-lean shape (`doc/approaches/2026-05-29-artifact-content-viewer.md`,
// Phase 1, PR artifact kind): an INDEPENDENT right-side viewer column.
// R₁ (`RPrsSection`) stays a pure inventory; clicking a PR row there
// selects it and this column renders that PR's full content — diff,
// body, comments (incl. CodeRabbit), labels, mergeable / review / check
// status, CI status + failure-log drill-down — entirely in-tmai, with
// ZERO github.com round-trip. It serves
// `2026-05-16-dev-loop-completes-in-tmai`.
//
// Negative space (the serving `2026-05-26-tmai-states-facts-not-appraisals`
// posture — tmai states facts, never appraises):
//   - the viewer NEVER auto-opens; it only mounts on an explicit operator
//     row click (the parent gates the mount on `selectedPr !== null`);
//   - NO "changed since you last looked" / unread / unseen / read-done
//     markers, NO TL;DR / auto-summary, NO relevance / priority / severity
//     tinting on status facts;
//   - mechanical facts (CI status, merge state, comment count, timestamps)
//     stay PLAIN inline and always visible (silence-is-not-neutral) — they
//     use only `text-foreground` / `text-muted-foreground` /
//     `text-subtle-foreground`, never the C-column warning / destructive /
//     success accents.
//
// The ONE allowed convention is the standard unified-diff `+`/`-`
// red/green colouring inside the reused `DiffViewer` — that IS the diff
// fact's conventional representation, not an appraisal layered on top, so
// `DiffViewer` is used as-is.

import { useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { DiffViewer } from "@/components/worktree/DiffViewer";
import {
  usePrBody,
  usePrChecks,
  usePrComments,
  usePrDiff,
  usePrLabels,
  usePrMergeStatus,
} from "@/hooks/usePrDetail";
import {
  api,
  type CiCheck,
  type PrComment,
  type PrMergeStatus,
  type PrSummaryWire,
} from "@/lib/api";

// What R₁ hands R₂ on a row click. The full `PrSummaryWire` rides along
// so the header renders every inventory fact (CI / review / draft /
// counts) without re-fetching; `repoPath` + the PR number drive the
// detail fetches.
export interface SelectedPr {
  repoPath: string;
  repoLabel: string;
  pr: PrSummaryWire;
}

export function selectedPrKey(repoPath: string, prNumber: bigint): string {
  return `${repoPath}#${prNumber}`;
}

// Markdown prose classes — same palette the transcript / digest markdown
// uses so the body and comments read like the rest of the WebUI.
const PROSE_CLASSES = `prose prose-invert prose-sm max-w-none
  prose-headings:text-foreground prose-headings:font-semibold
  prose-p:text-foreground prose-p:leading-relaxed prose-p:my-1
  prose-a:text-info prose-a:no-underline hover:prose-a:underline
  prose-strong:text-foreground
  prose-code:text-primary prose-code:bg-surface prose-code:rounded prose-code:px-1 prose-code:py-0.5 prose-code:text-xs prose-code:before:content-none prose-code:after:content-none
  prose-pre:bg-surface-strong/50 prose-pre:border prose-pre:border-hairline prose-pre:rounded-lg prose-pre:my-1
  prose-li:text-foreground prose-li:my-0
  prose-ul:my-1 prose-ol:my-1
  prose-th:text-foreground prose-th:border-hairline-strong
  prose-td:text-muted-foreground prose-td:border-hairline-strong
  prose-hr:border-hairline-strong
  prose-blockquote:border-info/30 prose-blockquote:text-muted-foreground`;

interface RPrViewerProps {
  selected: SelectedPr;
  onClose: () => void;
}

export function RPrViewer({ selected, onClose }: RPrViewerProps) {
  const { repoPath, repoLabel, pr } = selected;
  const prNumber = Number(pr.number);

  return (
    <aside
      data-testid="r-pr-viewer"
      className="glass flex w-[clamp(22rem,40vw,48rem)] shrink-0 flex-col border-l border-hairline"
    >
      <ViewerHeader repoLabel={repoLabel} pr={pr} onClose={onClose} />
      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3 text-xs">
        <LabelsSection repoPath={repoPath} prNumber={prNumber} />
        <MergeStatusSection repoPath={repoPath} prNumber={prNumber} />
        <CiSection repoPath={repoPath} branch={pr.head_branch} />
        <BodySection repoPath={repoPath} prNumber={prNumber} />
        <CommentsSection repoPath={repoPath} prNumber={prNumber} />
        <DiffSection repoPath={repoPath} prNumber={prNumber} />
      </div>
    </aside>
  );
}

// ── Header — mechanical inventory facts, all plain (no severity tint) ──

function ViewerHeader({
  repoLabel,
  pr,
  onClose,
}: {
  repoLabel: string;
  pr: PrSummaryWire;
  onClose: () => void;
}) {
  return (
    <header className="shrink-0 border-b border-hairline px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-subtle-foreground">{repoLabel}</p>
          <h2 className="text-sm font-semibold text-foreground">
            <span className="font-mono text-muted-foreground">#{Number(pr.number)}</span> {pr.title}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          title="Close PR viewer"
          aria-label="Close PR viewer"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-strong hover:text-foreground"
        >
          ×
        </button>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-subtle-foreground">
        <span className="font-mono">
          {pr.head_branch} → {pr.base_branch}
        </span>
        <span className="text-muted-foreground">
          +{Number(pr.additions)} −{Number(pr.deletions)}
        </span>
        {pr.check_status !== null && (
          <span className="text-muted-foreground">CI {pr.check_status}</span>
        )}
        {pr.review_decision !== null && (
          <span className="text-muted-foreground">{pr.review_decision}</span>
        )}
        {pr.is_draft && <span className="text-muted-foreground">draft</span>}
        <span className="text-muted-foreground">{Number(pr.comments)} comments</span>
        <span>@{pr.author}</span>
      </div>
    </header>
  );
}

// ── Section frame + async states (plain, never a fabricated empty) ──

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

function Loading() {
  return <p className="text-subtle-foreground">Loading…</p>;
}

function FetchError({ what, message }: { what: string; message: string }) {
  return (
    <p className="text-muted-foreground">
      Failed to load {what}: {message}
    </p>
  );
}

// ── Labels ──

function LabelsSection({ repoPath, prNumber }: { repoPath: string; prNumber: number }) {
  const { data, loading, error } = usePrLabels(repoPath, prNumber);
  return (
    <SectionFrame title="Labels">
      {loading && <Loading />}
      {error && <FetchError what="labels" message={error.message} />}
      {!loading && !error && (data === null || data.length === 0) && (
        <p className="text-subtle-foreground">No labels.</p>
      )}
      {data !== null && data.length > 0 && (
        <ul className="flex flex-wrap gap-1">
          {data.map((label) => (
            <li
              key={label}
              className="rounded border border-hairline-strong/40 bg-surface px-1.5 py-0.5 text-[11px] text-foreground"
            >
              {label}
            </li>
          ))}
        </ul>
      )}
    </SectionFrame>
  );
}

// ── Mergeable / review / check status ──

function MergeStatusSection({ repoPath, prNumber }: { repoPath: string; prNumber: number }) {
  const { data, loading, error } = usePrMergeStatus(repoPath, prNumber);
  return (
    <SectionFrame title="Merge status">
      {loading && <Loading />}
      {error && <FetchError what="merge status" message={error.message} />}
      {data !== null && <MergeStatusFacts status={data} />}
    </SectionFrame>
  );
}

function MergeStatusFacts({ status }: { status: PrMergeStatus }) {
  // All plain rows — these are mechanical facts, never severity-tinted.
  const rows: { label: string; value: string }[] = [
    { label: "mergeable", value: status.mergeable },
    { label: "state", value: status.merge_state_status },
    { label: "review", value: status.review_decision ?? "none" },
    { label: "checks", value: status.check_status ?? "none" },
  ];
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
      {rows.map((r) => (
        <div key={r.label} className="contents">
          <dt className="text-subtle-foreground">{r.label}</dt>
          <dd className="font-mono text-foreground">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

// ── CI status + failure-log drill-down ──

function CiSection({ repoPath, branch }: { repoPath: string; branch: string }) {
  const { data, loading, error } = usePrChecks(repoPath, branch);
  return (
    <SectionFrame title="CI">
      {loading && <Loading />}
      {error && <FetchError what="CI status" message={error.message} />}
      {!loading && !error && data !== null && data.checks.length === 0 && (
        <p className="text-subtle-foreground">No checks.</p>
      )}
      {data !== null && data.checks.length > 0 && (
        <div className="space-y-1">
          <p className="text-subtle-foreground">
            rollup <span className="font-mono text-foreground">{data.rollup}</span>
          </p>
          <ul className="space-y-1">
            {data.checks.map((check) => (
              <CiCheckRow key={check.name} repoPath={repoPath} check={check} />
            ))}
          </ul>
        </div>
      )}
    </SectionFrame>
  );
}

function CiCheckRow({ repoPath, check }: { repoPath: string; check: CiCheck }) {
  const [log, setLog] = useState<string | null>(null);
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  // Failure log is a drill-down: fetched on the first operator click and
  // cached for the row's lifetime. Only failed checks carrying a `run_id`
  // can be drilled into (the log is keyed by Actions run).
  const canDrill = check.conclusion === "failure" && check.run_id !== null;

  const toggleLog = () => {
    const opening = !open;
    setOpen(opening);
    if (!opening || log !== null || logLoading || check.run_id === null) return;
    setLogLoading(true);
    setLogError(null);
    api
      .getCiFailureLog(repoPath, check.run_id)
      .then((res) => setLog(res.log_text))
      .catch((e: unknown) => setLogError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLogLoading(false));
  };

  return (
    <li>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-mono text-foreground">{check.name}</span>
        <span className="text-subtle-foreground">{check.status}</span>
        {check.conclusion !== null && (
          <span className="text-muted-foreground">{check.conclusion}</span>
        )}
        {canDrill && (
          <button
            type="button"
            onClick={toggleLog}
            className="rounded bg-surface px-1.5 py-0.5 text-[10px] text-foreground transition-colors hover:bg-surface-strong"
          >
            {open ? "Hide failure log" : "View failure log"}
          </button>
        )}
      </div>
      {open && (
        <div className="mt-1">
          {logLoading && <Loading />}
          {logError && <FetchError what="failure log" message={logError} />}
          {log !== null && (
            <pre className="max-h-80 overflow-auto rounded border border-hairline bg-surface-strong/40 px-2 py-1 text-[10.5px] leading-relaxed text-muted-foreground">
              {log}
            </pre>
          )}
        </div>
      )}
    </li>
  );
}

// ── PR body (markdown) ──

function BodySection({ repoPath, prNumber }: { repoPath: string; prNumber: number }) {
  const { data, loading, error } = usePrBody(repoPath, prNumber);
  const empty = data !== null && data.trim() === "";
  return (
    <SectionFrame title="Description">
      {loading && <Loading />}
      {error && <FetchError what="description" message={error.message} />}
      {empty && <p className="text-subtle-foreground">No description.</p>}
      {data !== null && !empty && (
        <div className={PROSE_CLASSES}>
          <Markdown remarkPlugins={[remarkGfm]}>{data}</Markdown>
        </div>
      )}
    </SectionFrame>
  );
}

// ── Comments (PR-level + inline, incl. CodeRabbit) ──

function CommentsSection({ repoPath, prNumber }: { repoPath: string; prNumber: number }) {
  const { data, loading, error } = usePrComments(repoPath, prNumber);
  return (
    <SectionFrame title={data !== null ? `Comments (${data.length})` : "Comments"}>
      {loading && <Loading />}
      {error && <FetchError what="comments" message={error.message} />}
      {!loading && !error && data !== null && data.length === 0 && (
        <p className="text-subtle-foreground">No comments.</p>
      )}
      {data !== null && data.length > 0 && (
        <ul className="space-y-2">
          {data.map((c) => (
            // A comment's `url` is unique per GitHub comment — a stable key
            // with no array index needed.
            <CommentItem key={c.url} comment={c} />
          ))}
        </ul>
      )}
    </SectionFrame>
  );
}

function CommentItem({ comment }: { comment: PrComment }) {
  const inline = comment.path !== null;
  return (
    <li className="rounded border border-hairline-strong/40 bg-surface-strong/20 px-2 py-1.5">
      <div className="flex flex-wrap items-baseline gap-x-2 text-[11px]">
        <span className="font-semibold text-foreground">@{comment.author}</span>
        <span className="text-subtle-foreground">{comment.created_at}</span>
        {inline && <span className="font-mono text-subtle-foreground">{comment.path}</span>}
      </div>
      {inline && comment.diff_hunk !== null && comment.diff_hunk !== "" && (
        <pre className="mt-1 overflow-x-auto rounded border border-hairline bg-surface-strong/40 px-2 py-1 font-mono text-[10.5px] leading-relaxed text-muted-foreground">
          {comment.diff_hunk}
        </pre>
      )}
      <div className={`mt-1 ${PROSE_CLASSES}`}>
        <Markdown remarkPlugins={[remarkGfm]}>{comment.body}</Markdown>
      </div>
    </li>
  );
}

// ── Diff (reuses DiffViewer; +/- red/green is the diff convention) ──

function DiffSection({ repoPath, prNumber }: { repoPath: string; prNumber: number }) {
  const { data, loading, error } = usePrDiff(repoPath, prNumber);
  const empty = data !== null && data.trim() === "";
  return (
    <SectionFrame title="Diff">
      {loading && <Loading />}
      {error && <FetchError what="diff" message={error.message} />}
      {empty && <p className="text-subtle-foreground">Empty diff (head matches base).</p>}
      {data !== null && !empty && <DiffViewer diff={data} />}
    </SectionFrame>
  );
}
