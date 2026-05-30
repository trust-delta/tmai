// R₂ — the in-tmai PR content viewer + action layer (#749 content;
// action layer per the spine `2026-05-29-c-and-r-as-the-development-
// substrate` "🔀 PRs (iii)").
//
// γ-lean shape (`doc/approaches/2026-05-29-artifact-content-viewer.md`,
// Phase 1, PR artifact kind): an INDEPENDENT right-side viewer column.
// R₁ (`RPrsSection`) stays a pure inventory; clicking a PR row there
// selects it and this column renders that PR's full content — diff,
// body, comments (incl. CodeRabbit), labels, mergeable / review / check
// status, CI status + failure-log drill-down — entirely in-tmai, with
// ZERO github.com round-trip, plus the action layer (merge soft-valve /
// billing-dead override / CI rerun). It serves
// `2026-05-16-dev-loop-completes-in-tmai` and makes R the SINGLE PR
// surface (§C: no two coexisting merge paths — the C-column
// `UnitPrsSection` is retired).
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
// The status-fact plainness rule does NOT extend to the action layer:
// action buttons are affordances, not status facts, so the merge
// soft-valve's success / warning / destructive accents ARE load-bearing
// (delivered → frictionless / not-delivered → friction / Confirm /
// override) — see `ViewerActions`. The other allowed convention is the
// standard unified-diff `+`/`-` red/green colouring inside the reused
// `DiffViewer` — that IS the diff fact's conventional representation, not
// an appraisal layered on top, so `DiffViewer` is used as-is.

import { useEffect, useState } from "react";
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
  type PrMergeOverride,
  type PrMergeStatus,
  type PrSummaryWire,
} from "@/lib/api";

// What R₁ hands R₂ on a row click. The full `PrSummaryWire` rides along
// so the header renders every inventory fact (CI / review / draft /
// counts) without re-fetching; `repoPath` + the PR number drive the
// detail fetches.
//
// `billingDead` is the repo-level `[github.<repo>] billing_dead` flag —
// it lives on `RepoPrsWire`, NOT on `PrSummaryWire`, so R₁ threads it
// down here for the override-merge affordance (see `ViewerActions`).
export interface SelectedPr {
  repoPath: string;
  repoLabel: string;
  pr: PrSummaryWire;
  billingDead: boolean;
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
  const { repoPath, repoLabel, pr, billingDead } = selected;
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
      {/* Action layer — the SINGLE PR merge surface (dev-loop DR §C: no
          two coexisting merge paths; the C-column `UnitPrsSection` is
          retired). Keyed by the PR so a fresh selection resets the merge
          / override / confirm lifecycle (mirrors `UnitPrsSection`'s
          per-row keying). */}
      <ViewerActions
        key={selectedPrKey(repoPath, pr.number)}
        repoPath={repoPath}
        pr={pr}
        billingDead={billingDead}
        onMerged={onClose}
      />
    </aside>
  );
}

// ── Actions — merge soft-valve + billing-dead override ──
//
// Ported 1:1 from the now-retired C-column `UnitPrsSection` `PrRow`. R₂
// is the single PR surface, so the action layer sits beside the content
// the operator just reviewed.
//
// Negative-space boundary: the viewer's STATUS facts (header /
// merge-status / CI) stay plain. These are ACTION affordances, not
// status facts — the soft-valve's success / warning / destructive
// accents are LOAD-BEARING (success = Δ-brief delivered → frictionless;
// warning = not delivered → friction; destructive = Confirm / override)
// and are preserved exactly as the C surface had them.

interface MergeState {
  busy: boolean;
  done: boolean;
  error: string | null;
  confirming: boolean;
}

const IDLE_MERGE: MergeState = { busy: false, done: false, error: null, confirming: false };

function ViewerActions({
  repoPath,
  pr,
  billingDead,
  onMerged,
}: {
  repoPath: string;
  pr: PrSummaryWire;
  /** `repo.billing_dead === true` — the repo (not the PR) is flagged
   *  billing-dead, so the CI-safe override affordance is offered. */
  billingDead: boolean;
  /** Called after a successful merge so the parent closes R₂ — the
   *  (now-merged) PR must not linger stale; R₁ reconciles on its next
   *  60s poll. */
  onMerged: () => void;
}) {
  const prNumber = Number(pr.number);
  const [merge, setMerge] = useState<MergeState>(IDLE_MERGE);

  // Phase B billing-dead CI-safe override (approach
  // `2026-05-20-billing-dead-ci-safe-override`). Distinct from the
  // producer_reviewed valve below — that valve governs only the *normal*
  // merge button's friction; this is a separate button + panel for the
  // narrow case where GitHub CI is red *only because* the repo's private
  // Actions billing lapsed. The UI just collects + sends the attestation;
  // the backend re-validates the per-repo `billing_dead` flag and is the
  // real gate.
  const [overrideOpen, setOverrideOpen] = useState(false);
  // Pre-fill the override textarea from the Producer's stored ci-local
  // attestation (`PrSummaryWire.ci_local_attestation`, approach
  // `2026-05-26-producer-supplied-override-attestation`) so the operator
  // need not hand-paste. The field stays editable — what's sent is the
  // textarea content, pre-filled or typed. `?? ""` because the wire field
  // is optional/nullable; absent ⇒ "" keeps the manual-paste fallback.
  const prefill = pr.ci_local_attestation ?? "";
  const hasPrefill = prefill !== "";
  const [attestation, setAttestation] = useState(prefill);
  // Whether the operator has touched the textarea since it was (re)armed.
  // A later poll (a re-selection of the same PR) can bring a changed
  // `prefill`; we adopt it ONLY while the field is still clean, never
  // clobbering an operator's edit (the load-bearing line). Cancel re-arms
  // it so a reopen re-syncs.
  const [attestationEdited, setAttestationEdited] = useState(false);
  useEffect(() => {
    if (!attestationEdited) {
      setAttestation(prefill);
    }
  }, [prefill, attestationEdited]);

  const showOverride = billingDead && pr.check_status === "FAILURE";

  // Stage-2 asymmetric-friction valve (approach
  // `2026-05-17-producer-review-gated-in-tmai-merge`). The unlock
  // predicate is a *delivered-state fact* — the Producer's Δ-brief
  // reached the operator — NOT a Producer approval / merge-worthiness
  // judgment (§E boundary). `undefined` and `false` are identical "not
  // delivered"; `=== true` keeps the client lockstep-free and crash-free
  // if the field is omitted on the wire. Transient: reflects the current
  // poll only, never persisted (it resets on engine restart).
  const reviewed = pr.producer_reviewed === true;

  // `override` is threaded straight through to `api.mergePr` and sent
  // only when present — the normal merge call is byte-for-byte
  // unchanged. Both paths share this one MergeState lifecycle.
  const doMerge = async (override?: PrMergeOverride) => {
    setMerge({ ...IDLE_MERGE, busy: true });
    try {
      // bigint → number: the JSON body cannot serialize a BigInt.
      await api.mergePr(repoPath, prNumber, {
        method: "squash",
        deleteBranch: true,
        ...(override ? { override } : {}),
      });
      setMerge({ ...IDLE_MERGE, done: true });
      onMerged();
    } catch (e) {
      setMerge({ ...IDLE_MERGE, error: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <footer data-testid="r-pr-actions" className="shrink-0 border-t border-hairline px-4 py-3">
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-subtle-foreground">
        Actions
      </h3>
      <div className="flex flex-wrap items-center gap-1.5">
        {reviewed ? (
          // Δ-brief delivered → frictionless: one click merges, no
          // arm/confirm step. Affirmative styling. The delivered marker
          // is NOT an approval — the merge call is still wholly the
          // operator's; core never blocks on the bit (§E boundary).
          <button
            type="button"
            onClick={() => void doMerge()}
            disabled={merge.busy}
            className="rounded bg-success/15 px-2 py-0.5 text-[11px] font-medium text-success transition-colors hover:bg-success/25 disabled:opacity-50"
          >
            {merge.busy ? "Merging…" : `Merge #${prNumber}`}
          </button>
        ) : !merge.confirming ? (
          // No Δ-brief delivered → friction + visibility, never a
          // gate/block. Cautionary styling; arm → dismissible confirm.
          <button
            type="button"
            onClick={() => setMerge((m) => ({ ...m, confirming: true }))}
            disabled={merge.busy}
            className="rounded bg-warning/15 px-2 py-0.5 text-[11px] font-medium text-warning transition-colors hover:bg-warning/25 disabled:opacity-50"
          >
            Merge #{prNumber}
          </button>
        ) : (
          // Dismissible by construction: Confirm is always enabled (the
          // busy-disable is only a double-submit guard, not a gate) and
          // Cancel always exists. The operator can ALWAYS merge
          // regardless of review state — friction, not a block.
          <span className="inline-flex items-center gap-1">
            <span className="text-[11px] text-warning">
              Producer review not delivered for this PR — merge anyway?
            </span>
            <button
              type="button"
              onClick={() => void doMerge()}
              disabled={merge.busy}
              className="rounded bg-destructive/20 px-2 py-0.5 text-[11px] font-medium text-destructive transition-colors hover:bg-destructive/30 disabled:opacity-50"
            >
              {merge.busy ? "Merging…" : "Confirm"}
            </button>
            <button
              type="button"
              onClick={() => setMerge((m) => ({ ...m, confirming: false }))}
              disabled={merge.busy}
              className="rounded bg-surface px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-surface-strong disabled:opacity-50"
            >
              Cancel
            </button>
          </span>
        )}

        {/* Phase B billing-dead CI-safe override — a DISTINCT affordance
            from the merge button(s) above (outlined, not filled, so the
            two are never confused). Offered only when the repo is flagged
            billing-dead AND this PR's GitHub CI is red. */}
        {showOverride && (
          <button
            type="button"
            onClick={() => setOverrideOpen((open) => !open)}
            disabled={merge.busy}
            title="GitHub CI is red only because this repo's private Actions billing lapsed. Merge with a ci-local attestation — the backend re-validates the per-repo billing_dead flag and is the real gate."
            className="rounded border border-warning/50 bg-transparent px-2 py-0.5 text-[11px] font-medium text-warning transition-colors hover:bg-warning/10 disabled:opacity-50"
          >
            Override (ci-local attestation)
          </button>
        )}
      </div>

      {showOverride && overrideOpen && (
        <div className="mt-2 rounded border border-warning/40 bg-warning/[0.05] px-2 py-1.5">
          {hasPrefill ? (
            <p className="text-[10.5px] leading-relaxed text-warning">
              CI is red only because this repo's private Actions billing is dead. The Producer's{" "}
              <code className="text-foreground">ci-local</code> summary is pre-filled below —
              review/edit it, then confirm. The backend re-checks the per-repo{" "}
              <code className="text-foreground">billing_dead</code> flag + attestation before
              running <code className="text-foreground">gh pr merge --admin</code>.
            </p>
          ) : (
            <p className="text-[10.5px] leading-relaxed text-warning">
              CI is red only because this repo's private Actions billing is dead. Paste the{" "}
              <code className="text-foreground">ci-local</code> run summary; the backend re-checks
              the per-repo <code className="text-foreground">billing_dead</code> flag + attestation
              before running <code className="text-foreground">gh pr merge --admin</code>.
            </p>
          )}
          <textarea
            value={attestation}
            onChange={(e) => {
              setAttestation(e.target.value);
              setAttestationEdited(true);
            }}
            rows={4}
            aria-label="CI-local attestation for billing-dead override"
            placeholder="Paste the ci-local attestation (e.g. the `bash scripts/ci-local.sh` summary)…"
            className="mt-1.5 w-full rounded border border-hairline-strong/40 bg-surface px-2 py-1 font-mono text-[10.5px] text-foreground placeholder:text-subtle-foreground"
          />
          <div className="mt-1.5 flex items-center gap-1.5">
            {/* Disabled while empty mirrors the backend min-sanity; the
                backend stays the real gate (flag + attestation). */}
            <button
              type="button"
              onClick={() =>
                void doMerge({
                  ci_local_attestation: attestation,
                  repo_billing_dead_acknowledged: true,
                })
              }
              disabled={merge.busy || attestation.trim() === ""}
              className="rounded bg-destructive/20 px-2 py-0.5 text-[11px] font-medium text-destructive transition-colors hover:bg-destructive/30 disabled:opacity-50"
            >
              {merge.busy ? "Merging…" : `Override-merge #${prNumber}`}
            </button>
            <button
              type="button"
              onClick={() => {
                // Discard edits and re-arm the prop sync: reopening shows
                // the latest Producer prefill (or "" when absent), never a
                // stale paste.
                setOverrideOpen(false);
                setAttestation(prefill);
                setAttestationEdited(false);
              }}
              disabled={merge.busy}
              className="rounded bg-surface px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-surface-strong disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {merge.error && (
        <p className="mt-1 text-[10.5px] text-destructive/80">Merge failed: {merge.error}</p>
      )}
    </footer>
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

  // CI rerun (`POST /github/ci/rerun`) — a LIGHT/direct operator action,
  // no soft-valve gate (per the spine's Pattern A calibration: rerun is
  // direct, only merge/override are brief-gated). Keyed by the failed
  // check's Actions `run_id`, the same field the failure-log drill-down
  // uses, so it shares the `canDrill` gate (failed + has a run_id).
  const [rerunBusy, setRerunBusy] = useState(false);
  const [rerunDone, setRerunDone] = useState(false);
  const [rerunError, setRerunError] = useState<string | null>(null);

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

  const doRerun = () => {
    if (check.run_id === null || rerunBusy) return;
    setRerunBusy(true);
    setRerunError(null);
    api
      .rerunFailedChecks(repoPath, check.run_id)
      .then(() => setRerunDone(true))
      .catch((e: unknown) => setRerunError(e instanceof Error ? e.message : String(e)))
      .finally(() => setRerunBusy(false));
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
        {canDrill && (
          // Plain/neutral styling — a light direct action, not a
          // soft-valve affordance, so no severity accent (the rerun's
          // feedback below stays plain for the same reason).
          <button
            type="button"
            onClick={doRerun}
            disabled={rerunBusy || rerunDone}
            className="rounded bg-surface px-1.5 py-0.5 text-[10px] text-foreground transition-colors hover:bg-surface-strong disabled:opacity-50"
          >
            {rerunBusy ? "Rerunning…" : rerunDone ? "Rerun queued" : "CI rerun"}
          </button>
        )}
      </div>
      {rerunError && (
        <p className="mt-0.5 text-[10px] text-muted-foreground">Rerun failed: {rerunError}</p>
      )}
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
