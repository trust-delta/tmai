// R₂ — the in-tmai issue content viewer (per-repo, full body + comments,
// read-only). Serves the spine `2026-05-29-c-and-r-as-the-development-
// substrate` (the per-kind walk's "📋 Issues (ii) judgment-info" surface)
// + `2026-05-29-artifact-content-viewer` (γ-lean R₂ viewer) +
// `2026-05-16-dev-loop-completes-in-tmai` (read the project's issues
// in-tmai, no github.com round-trip).
//
// Mirrors `RPrViewer` / `RRecordViewer` posture exactly: an INDEPENDENT
// right-side column that NEVER auto-opens — it mounts only on an explicit
// operator row click in the R₁ inventory (the parent gates the mount on a
// non-null `selectedIssue`). R₁ (`RIssuesSection`) stays a pure
// inventory; this column renders the clicked issue's full content.
//
// SCOPE — read-only, per-repo, NO actions. This is the (ii) judgment-info
// viewer only. The (iii) lifecycle acts (close / comment / reopen) need
// an issue write endpoint that does NOT exist server-side and are
// explicitly deferred — the viewer mutates nothing, and there is no
// `[→Producer brief]` button. Issues stay PER-REPO (the existing
// `useIssues(repoPath)` single-project fetch); cross-repo unit-scoping is
// a deferred tmai-core follow-up.
//
// Unlike `RPrViewer` (which fans out N section fetches against several
// `gh`-backed endpoints), there is ONE issue-detail endpoint that returns
// the FULL issue — body, labels, assignees, timestamps, comments — so the
// viewer makes a single `useIssueDetail` fetch and renders every section
// off that one coherent object. Header identity (repoLabel / number /
// title / state) rides along in `selected` and renders immediately; the
// detail-only facts (timestamps, comment count) + the body/labels/
// assignees/comments fill in once the fetch resolves.
//
// Negative space (the serving `2026-05-26-tmai-states-facts-not-appraisals`
// posture — tmai states facts, never appraises):
//   - all status facts (state, labels, assignees, counts, timestamps)
//     stay PLAIN inline — `text-foreground` / `text-muted-foreground` /
//     `text-subtle-foreground` only, never warning / destructive /
//     success accents. An issue's "closed"/"open" state is a fact, not
//     an appraisal; a label's github colour is dropped for the same
//     reason (the chip is a plain fact);
//   - NO "changed since you last looked" / unread / TL;DR / auto-summary,
//     NO state-transition / cross-reference fabrication — only what the
//     wire carries is rendered;
//   - the ONE allowed convention is standard markdown rendering in the
//     body + comments (via the shared `PROSE_CLASSES`), same as the other
//     two R₂ viewers.

import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useIssueDetail } from "@/hooks/useIssueDetail";
import type { IssueComment, IssueDetail, IssueInfo, IssueLabel } from "@/lib/api";
import { PROSE_CLASSES } from "./prose";

// What R₁ hands R₂ on an issue row click. The full `IssueInfo` rides
// along (like `SelectedPr` carries the full `pr`) so the header renders
// identity facts without waiting on the detail fetch; `repoPath` + the
// issue number drive the detail fetch, and `repoLabel` reads identically
// to the PR / record selections. Issues are PER-REPO, so there is no
// unit / repo-level flag to thread (the asymmetry with `SelectedPr`'s
// `billingDead` is intentional — see scope note above).
export interface SelectedIssue {
  repoPath: string;
  repoLabel: string;
  issue: IssueInfo;
}

export function selectedIssueKey(repoPath: string, issueNumber: number): string {
  return `${repoPath}#${issueNumber}`;
}

interface RIssueViewerProps {
  selected: SelectedIssue;
  onClose: () => void;
}

export function RIssueViewer({ selected, onClose }: RIssueViewerProps) {
  const { repoPath, repoLabel, issue } = selected;
  const { data, loading, error } = useIssueDetail(repoPath, issue.number);

  return (
    <aside
      data-testid="r-issue-viewer"
      className="glass flex w-[clamp(22rem,40vw,48rem)] shrink-0 flex-col border-l border-hairline"
    >
      <ViewerHeader repoLabel={repoLabel} issue={issue} detail={data} onClose={onClose} />
      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3 text-xs">
        {loading && <Loading />}
        {error && <FetchError what="issue" message={error.message} />}
        {data !== null && (
          <>
            <LabelsSection labels={data.labels} />
            <AssigneesSection assignees={data.assignees} />
            <BodySection body={data.body} />
            <CommentsSection comments={data.comments} />
          </>
        )}
      </div>
    </aside>
  );
}

// ── Header — mechanical inventory facts, all plain (no severity tint) ──
//
// Identity (repoLabel / number / title / state) renders immediately from
// the ride-along `issue`; the detail-only facts (created / updated /
// comment count) appear once `detail` resolves. All plain — an issue's
// open/closed state and its timestamps are facts, not appraisals.

function ViewerHeader({
  repoLabel,
  issue,
  detail,
  onClose,
}: {
  repoLabel: string;
  issue: IssueInfo;
  detail: IssueDetail | null;
  onClose: () => void;
}) {
  return (
    <header className="shrink-0 border-b border-hairline px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-subtle-foreground">
            {repoLabel} · issue
          </p>
          <h2 className="text-sm font-semibold text-foreground">
            <span className="font-mono text-muted-foreground">#{issue.number}</span> {issue.title}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          title="Close issue viewer"
          aria-label="Close issue viewer"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-strong hover:text-foreground"
        >
          ×
        </button>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-subtle-foreground">
        <span className="text-muted-foreground">{issue.state.toLowerCase()}</span>
        {detail !== null && (
          <>
            <span className="text-muted-foreground">created {detail.created_at}</span>
            <span className="text-muted-foreground">updated {detail.updated_at}</span>
            <span className="text-muted-foreground">{detail.comments.length} comments</span>
          </>
        )}
      </div>
    </header>
  );
}

// ── Section frame + async states (plain, never a fabricated empty) ──
//
// Ported 1:1 from `RPrViewer` so the three R₂ viewers read identically.

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

// ── Labels — plain chips (github label colour dropped: a plain fact) ──

function LabelsSection({ labels }: { labels: IssueLabel[] }) {
  return (
    <SectionFrame title="Labels">
      {labels.length === 0 ? (
        <p className="text-subtle-foreground">No labels.</p>
      ) : (
        <ul className="flex flex-wrap gap-1">
          {labels.map((label) => (
            <li
              key={label.name}
              className="rounded border border-hairline-strong/40 bg-surface px-1.5 py-0.5 text-[11px] text-foreground"
            >
              {label.name}
            </li>
          ))}
        </ul>
      )}
    </SectionFrame>
  );
}

// ── Assignees — plain list; "Unassigned." when empty ──

function AssigneesSection({ assignees }: { assignees: string[] }) {
  return (
    <SectionFrame title="Assignees">
      {assignees.length === 0 ? (
        <p className="text-subtle-foreground">Unassigned.</p>
      ) : (
        <ul className="flex flex-wrap gap-x-3 gap-y-0.5">
          {assignees.map((a) => (
            <li key={a} className="text-foreground">
              @{a}
            </li>
          ))}
        </ul>
      )}
    </SectionFrame>
  );
}

// ── Issue body (markdown via the shared PROSE_CLASSES) ──

function BodySection({ body }: { body: string }) {
  const empty = body.trim() === "";
  return (
    <SectionFrame title="Description">
      {empty ? (
        <p className="text-subtle-foreground">No description.</p>
      ) : (
        <div className={PROSE_CLASSES}>
          <Markdown remarkPlugins={[remarkGfm]}>{body}</Markdown>
        </div>
      )}
    </SectionFrame>
  );
}

// ── Comments — chronological (wire order), plain PR-level only ──
//
// Issues have NO inline diff_hunk / path (those are PR review-comment
// concepts); `IssueComment` is a plain author / created_at / body triple.
// The wire delivers comments in chronological order; the viewer preserves
// it (no re-sort, no fabricated transition events).

function CommentsSection({ comments }: { comments: IssueComment[] }) {
  return (
    <SectionFrame title={`Comments (${comments.length})`}>
      {comments.length === 0 ? (
        <p className="text-subtle-foreground">No comments.</p>
      ) : (
        <ul className="space-y-2">
          {comments.map((c) => (
            // A comment's `url` is unique per GitHub comment — a stable key
            // with no array index needed.
            <CommentItem key={c.url} comment={c} />
          ))}
        </ul>
      )}
    </SectionFrame>
  );
}

function CommentItem({ comment }: { comment: IssueComment }) {
  return (
    <li className="rounded border border-hairline-strong/40 bg-surface-strong/20 px-2 py-1.5">
      <div className="flex flex-wrap items-baseline gap-x-2 text-[11px]">
        <span className="font-semibold text-foreground">@{comment.author}</span>
        <span className="text-subtle-foreground">{comment.created_at}</span>
      </div>
      <div className={`mt-1 ${PROSE_CLASSES}`}>
        <Markdown remarkPlugins={[remarkGfm]}>{comment.body}</Markdown>
      </div>
    </li>
  );
}
