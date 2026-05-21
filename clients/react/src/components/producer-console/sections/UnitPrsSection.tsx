// 🔀 Open PRs — the Producer console's Stage-1 in-tmai dev-loop surface,
// wired to `GET /api/units/{unit}/prs` (tmai-core PR #389, DR
// `2026-05-16-dev-loop-completes-in-tmai.md` §A/§B/§C).
//
// Three Stage-1 capabilities, deliberately scoped:
//   §A  one *unified* cross-repo list of the unit's open PRs — repos
//       grouped, primary-first, each PR repo-tagged. NOT a per-repo
//       switcher: a recent decision closed the mis-selection burden a
//       switcher re-introduces, so this stays one list.
//   §B  review the code diff in-tmai (`GET /api/github/pr/diff`),
//       rendered with the existing worktree `DiffViewer`.
//   §C  a direct operator merge button (`POST /api/github/pr/merge`) —
//       this replaces the retired AI-merge delegation in
//       ActionPanel/PrCard. The operator merges directly, never via a
//       spawned agent (no two coexisting merge paths).
//
// Explicitly out of scope (later stages): in-tmai approve / request-
// changes / comment, issue triage, CI re-run, branch ops.
//
// Honest-degradation posture, same as the sibling sections
// (`doc/decisions/2026-05-14-webui-simulated-onboarded-posture.md`):
// `unit = null` → pick-a-project notice (no fetch); a load error reads
// as a failure with a `gh`/github.com fallback hint, never a fabricated
// empty list.

import { useState } from "react";
import { DiffViewer } from "@/components/worktree/DiffViewer";
import { useUnitPrs } from "@/hooks/useUnitPrs";
import { api, type PrMergeOverride, type PrSummaryWire, type RepoPrsWire } from "@/lib/api";

interface UnitPrsSectionProps {
  unitName: string | null;
}

export function UnitPrsSection({ unitName }: UnitPrsSectionProps) {
  const { data, loading, error } = useUnitPrs(unitName);

  return (
    <section>
      <header className="mb-2 flex items-baseline gap-2">
        <span className="text-base text-primary">🔀</span>
        <h3 className="text-sm font-semibold text-foreground">Open PRs</h3>
        {loading && data === null && (
          <span className="text-[10px] text-muted-foreground">loading…</span>
        )}
      </header>
      <Body unitName={unitName} data={data} loading={loading} error={error} />
    </section>
  );
}

interface BodyProps {
  unitName: string | null;
  data: ReturnType<typeof useUnitPrs>["data"];
  loading: boolean;
  error: Error | null;
}

function Body({ unitName, data, loading, error }: BodyProps) {
  if (unitName === null) {
    return (
      <div className="pl-6 text-xs text-muted-foreground">
        <p>
          Pick a project (a unit chip in{" "}
          <span className="text-muted-foreground">⬢ Cross-unit status</span> above, or the sidebar)
          to see its open PRs across every repo.
        </p>
      </div>
    );
  }

  if (error !== null) {
    return (
      <div className="pl-6 text-xs text-destructive/80">
        <p>
          Failed to load PRs: <code className="text-destructive">{error.message}</code>
        </p>
        <p className="mt-1 text-muted-foreground">
          Fall back to <code className="text-foreground">gh pr list</code> in each repo, or
          github.com.
        </p>
      </div>
    );
  }

  if (data === null && loading) {
    return <div className="pl-6 text-xs text-muted-foreground">Loading…</div>;
  }

  const totalPrs = data === null ? 0 : data.repos.reduce((n, r) => n + r.prs.length, 0);

  if (data === null || totalPrs === 0) {
    return (
      <div className="pl-6 text-xs text-muted-foreground">
        <p>
          No open PRs for <code className="text-foreground">{unitName}</code> across its repos.
        </p>
      </div>
    );
  }

  // Keyed by unit so the optimistic-merge bookkeeping resets cleanly
  // when the operator switches projects (a stale `repo#n` key could
  // otherwise hide a same-numbered PR in a different unit).
  return <PrList key={unitName} repos={data.repos} />;
}

// One row's transient UI state (diff drawer + merge lifecycle). Kept
// out of the wire types — purely client-side.
interface MergeState {
  busy: boolean;
  done: boolean;
  error: string | null;
  confirming: boolean;
}

const IDLE_MERGE: MergeState = { busy: false, done: false, error: null, confirming: false };

function prKey(repoPath: string, prNumber: bigint): string {
  return `${repoPath}#${prNumber}`;
}

function PrList({ repos }: { repos: RepoPrsWire[] }) {
  // Repos arrive primary-first then declaration order; render that
  // order verbatim. Single-repo unit → no repo headers (the list is
  // already unambiguous); multi-repo → a thin label so each PR's
  // origin is legible without turning the list into a switcher.
  const multiRepo = repos.length > 1;
  const [merge, setMerge] = useState<Record<string, MergeState>>({});

  // `override` (Phase B billing-dead CI-safe path) is threaded straight
  // through to `api.mergePr` and is sent only when present — the normal
  // merge call is byte-for-byte unchanged. Both paths share this one
  // MergeState lifecycle (busy/done/error) per the brief.
  const onMerge = async (repoPath: string, pr: PrSummaryWire, override?: PrMergeOverride) => {
    const key = prKey(repoPath, pr.number);
    setMerge((m) => ({ ...m, [key]: { ...IDLE_MERGE, busy: true } }));
    try {
      // bigint → number: the JSON body cannot serialize a BigInt.
      await api.mergePr(repoPath, Number(pr.number), {
        method: "squash",
        deleteBranch: true,
        ...(override ? { override } : {}),
      });
      setMerge((m) => ({ ...m, [key]: { ...IDLE_MERGE, done: true } }));
    } catch (e) {
      setMerge((m) => ({
        ...m,
        [key]: { ...IDLE_MERGE, error: e instanceof Error ? e.message : String(e) },
      }));
    }
  };

  return (
    <div className="space-y-3 pl-6 text-xs">
      {repos.map((repo) => (
        <div key={repo.repo_path} className="space-y-2">
          {multiRepo && (
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <code className="font-mono text-foreground">{repo.repo_label}</code>
              {repo.primary && <span className="ml-1 text-primary">(primary)</span>}
              <span className="ml-2 text-subtle-foreground">{repo.prs.length} open</span>
            </h4>
          )}
          {repo.prs.length === 0 ? (
            <p className="text-[11px] text-subtle-foreground">No open PRs.</p>
          ) : (
            <ul className="space-y-2">
              {repo.prs.map((pr) => (
                <PrRow
                  key={prKey(repo.repo_path, pr.number)}
                  repoPath={repo.repo_path}
                  pr={pr}
                  // billing-dead lives on the REPO, not the PR — thread it
                  // down the same way the rest of the row is mapped from
                  // `repo.prs`. Absent-when-false ⇒ `=== true`.
                  billingDead={repo.billing_dead === true}
                  merge={merge[prKey(repo.repo_path, pr.number)] ?? IDLE_MERGE}
                  onMerge={() => onMerge(repo.repo_path, pr)}
                  onOverrideMerge={(attestation) =>
                    onMerge(repo.repo_path, pr, {
                      ci_local_attestation: attestation,
                      repo_billing_dead_acknowledged: true,
                    })
                  }
                  onArmMerge={(armed) =>
                    setMerge((m) => ({
                      ...m,
                      [prKey(repo.repo_path, pr.number)]: {
                        ...(m[prKey(repo.repo_path, pr.number)] ?? IDLE_MERGE),
                        confirming: armed,
                      },
                    }))
                  }
                />
              ))}
            </ul>
          )}
        </div>
      ))}
      <p className="text-[10.5px] leading-relaxed text-subtle-foreground">
        Merging here runs{" "}
        <code className="text-foreground">gh pr merge --squash --delete-branch</code> directly — no
        agent in the loop. The list reconciles on the next 60s poll.
      </p>
    </div>
  );
}

function reviewBadge(decision: string | null): { label: string; cls: string } | null {
  switch (decision) {
    case "APPROVED":
      return { label: "approved", cls: "text-success" };
    case "CHANGES_REQUESTED":
      return { label: "changes requested", cls: "text-destructive" };
    case "REVIEW_REQUIRED":
      return { label: "review required", cls: "text-warning" };
    default:
      return decision ? { label: decision.toLowerCase(), cls: "text-muted-foreground" } : null;
  }
}

function checkBadge(status: string | null): { label: string; cls: string } | null {
  switch (status) {
    case "SUCCESS":
      return { label: "CI ✓", cls: "text-success" };
    case "FAILURE":
      return { label: "CI ✗", cls: "text-destructive" };
    case "PENDING":
      return { label: "CI …", cls: "text-warning" };
    default:
      return status ? { label: `CI ${status.toLowerCase()}`, cls: "text-muted-foreground" } : null;
  }
}

interface PrRowProps {
  repoPath: string;
  pr: PrSummaryWire;
  /** `repo.billing_dead === true` — the repo (not the PR) is flagged
   *  billing-dead, so the CI-safe override affordance is offered. */
  billingDead: boolean;
  merge: MergeState;
  onMerge: () => void;
  /** Fire the Phase B billing-dead CI-safe override merge with the
   *  pasted ci-local attestation. */
  onOverrideMerge: (attestation: string) => void;
  onArmMerge: (armed: boolean) => void;
}

function PrRow({
  repoPath,
  pr,
  billingDead,
  merge,
  onMerge,
  onOverrideMerge,
  onArmMerge,
}: PrRowProps) {
  const [diffOpen, setDiffOpen] = useState(false);
  const [patch, setPatch] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);

  // Phase B billing-dead CI-safe override (approach
  // `2026-05-20-billing-dead-ci-safe-override`). Distinct from the
  // Stage-2 producer_reviewed valve below — that valve only governs the
  // *normal* merge button's friction; this is a separate button + panel
  // for the narrow case where GitHub CI is red *only because* the repo's
  // private Actions billing lapsed. The UI just collects + sends the
  // attestation; the backend re-validates the per-repo `billing_dead`
  // flag and is the real gate.
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [attestation, setAttestation] = useState("");
  const showOverride = billingDead && pr.check_status === "FAILURE";

  // Lazy: fetch the patch on the first open and cache it for the row's
  // lifetime (an open PR's diff is stable enough for a review pass).
  // WHY a click-driven fetch rather than an effect keyed on `diffOpen`:
  // an effect that also reads `diffLoading` in its deps re-runs the
  // moment the in-flight flag flips, and its cleanup then marks the
  // first run cancelled — so the resolved patch is dropped and the
  // drawer never paints. Fetching here side-steps that race entirely.
  const toggleDiff = () => {
    const opening = !diffOpen;
    setDiffOpen(opening);
    if (!opening || patch !== null || diffLoading) return;
    setDiffLoading(true);
    setDiffError(null);
    api
      .prDiff(repoPath, Number(pr.number))
      .then((res) => setPatch(res.patch))
      .catch((e: unknown) => setDiffError(e instanceof Error ? e.message : String(e)))
      .finally(() => setDiffLoading(false));
  };

  const review = reviewBadge(pr.review_decision);
  const check = checkBadge(pr.check_status);

  // Stage-2 asymmetric-friction valve (approach
  // `2026-05-17-producer-review-gated-in-tmai-merge`). The unlock
  // predicate is a *delivered-state fact* — the Producer's Δ-brief
  // reached the operator — NOT a Producer approval / merge-worthiness
  // judgment (PrSummaryWire.producer_reviewed §E boundary). `undefined`
  // and `false` are identical "not delivered" (absent-when-false on the
  // wire); `=== true` keeps the client lockstep-free and crash-free if
  // the field is omitted. Transient: reflects the current poll only,
  // never persisted/cached (it resets on engine restart).
  const reviewed = pr.producer_reviewed === true;

  if (merge.done) {
    return (
      <li className="rounded border border-success/30 bg-success/[0.05] px-2 py-1.5 text-[11px] text-success">
        ✓ Merged #{Number(pr.number)} — <span className="text-muted-foreground">{pr.title}</span>.
        Drops from the list on the next refresh.
      </li>
    );
  }

  return (
    <li className="rounded border border-hairline-strong/40 bg-surface-strong/20 px-2 py-1.5">
      <div className="flex items-baseline gap-1.5">
        <a
          href={pr.url}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-[11px] text-primary hover:underline"
        >
          #{Number(pr.number)}
        </a>
        <span className="flex-1 text-[11px] leading-snug text-foreground">{pr.title}</span>
        {pr.is_draft && <span className="shrink-0 text-[10px] text-subtle-foreground">draft</span>}
      </div>

      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
        <span className="font-mono text-subtle-foreground">
          {pr.head_branch} → {pr.base_branch}
        </span>
        <span>
          <span className="text-success">+{Number(pr.additions)}</span>{" "}
          <span className="text-destructive">-{Number(pr.deletions)}</span>
        </span>
        {review && <span className={review.cls}>{review.label}</span>}
        {check && <span className={check.cls}>{check.label}</span>}
        {reviewed && (
          <span
            className="text-success"
            title="Producer's Δ-brief delivered for this PR — delivered, not approved; the merge call is yours"
          >
            Δ-brief ✓
          </span>
        )}
        <span className="text-subtle-foreground">@{pr.author}</span>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={toggleDiff}
          className="rounded bg-surface px-2 py-0.5 text-[11px] text-foreground transition-colors hover:bg-surface-strong"
        >
          {diffOpen ? "Hide diff" : "View diff"}
        </button>

        {reviewed ? (
          // Δ-brief delivered → frictionless: one click merges, no
          // arm/confirm step. Calm/affirmative styling. The delivered
          // marker is NOT an approval — the merge call is still wholly
          // the operator's; core never blocks on the bit (§E boundary).
          <button
            type="button"
            onClick={onMerge}
            disabled={merge.busy}
            className="rounded bg-success/15 px-2 py-0.5 text-[11px] font-medium text-success transition-colors hover:bg-success/25 disabled:opacity-50"
          >
            {merge.busy ? "Merging…" : `Merge #${Number(pr.number)}`}
          </button>
        ) : !merge.confirming ? (
          // No Δ-brief delivered → friction + visibility, never a
          // gate/block. Cautionary styling; arm → dismissible confirm.
          <button
            type="button"
            onClick={() => onArmMerge(true)}
            disabled={merge.busy}
            className="rounded bg-warning/15 px-2 py-0.5 text-[11px] font-medium text-warning transition-colors hover:bg-warning/25 disabled:opacity-50"
          >
            Merge #{Number(pr.number)}
          </button>
        ) : (
          // Dismissible by construction: Confirm is always enabled
          // (the busy-disable is only a double-submit guard, not a
          // gate) and Cancel always exists. The operator can ALWAYS
          // merge regardless of review state — friction, not a block.
          <span className="inline-flex items-center gap-1">
            <span className="text-[11px] text-warning">
              Producer review not delivered for this PR — merge anyway?
            </span>
            <button
              type="button"
              onClick={onMerge}
              disabled={merge.busy}
              className="rounded bg-destructive/20 px-2 py-0.5 text-[11px] font-medium text-destructive transition-colors hover:bg-destructive/30 disabled:opacity-50"
            >
              {merge.busy ? "Merging…" : "Confirm"}
            </button>
            <button
              type="button"
              onClick={() => onArmMerge(false)}
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
            title="GitHub CI is red only because this repo's private Actions billing lapsed. Merge with a pasted ci-local attestation — the backend re-validates the per-repo billing_dead flag and is the real gate."
            className="rounded border border-warning/50 bg-transparent px-2 py-0.5 text-[11px] font-medium text-warning transition-colors hover:bg-warning/10 disabled:opacity-50"
          >
            Override (ci-local attestation)
          </button>
        )}
      </div>

      {showOverride && overrideOpen && (
        <div className="mt-2 rounded border border-warning/40 bg-warning/[0.05] px-2 py-1.5">
          <p className="text-[10.5px] leading-relaxed text-warning">
            CI is red only because this repo's private Actions billing is dead. Paste the{" "}
            <code className="text-foreground">ci-local</code> run summary; the backend re-checks the
            per-repo <code className="text-foreground">billing_dead</code> flag + attestation before
            running <code className="text-foreground">gh pr merge --admin</code>.
          </p>
          <textarea
            value={attestation}
            onChange={(e) => setAttestation(e.target.value)}
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
              onClick={() => onOverrideMerge(attestation)}
              disabled={merge.busy || attestation.trim() === ""}
              className="rounded bg-destructive/20 px-2 py-0.5 text-[11px] font-medium text-destructive transition-colors hover:bg-destructive/30 disabled:opacity-50"
            >
              {merge.busy ? "Merging…" : `Override-merge #${Number(pr.number)}`}
            </button>
            <button
              type="button"
              onClick={() => {
                setOverrideOpen(false);
                setAttestation("");
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

      {diffOpen && (
        <div className="mt-2">
          {diffLoading && <p className="text-[11px] text-muted-foreground">Loading diff…</p>}
          {diffError && (
            <p className="text-[11px] text-destructive/80">
              Failed to load diff: <code className="text-destructive">{diffError}</code>
            </p>
          )}
          {!diffLoading && !diffError && patch !== null && <DiffViewer diff={patch} />}
        </div>
      )}
    </li>
  );
}
