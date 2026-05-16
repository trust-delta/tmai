// ▣ Active approaches — the Producer console's Verdict-inbox, wired to
// `GET /api/units/{unit}/approaches` (tmai-core PR #369).
//
// Essence (deliberately NOT the decisions surface — see
// `doc/decisions/2026-05-16-authority-attaches-to-the-act.md`): a decision
// is a settled commitment the operator attends to when it drifts; an
// approach is a *live experiment with a pending verdict*. So this surface
// triages by "does this need your verdict now?", not by temperature
// buckets. Low-priority bands are collapsed; only ⚡ is open.
//
// Client-degraded by design (A1). The wire is `status: active` only and
// carries no resolved trigger/verdict state, so the client can faithfully
// evaluate only `kind: date` triggers (vs today) + `confidence`. Triggers
// the engine must resolve (pr-*/issue-closed/decision-status/approach-
// status/manual) and the human-vs-Producer verdict split are surfaced
// honestly, never fabricated — per the simulated-onboarded posture
// (`doc/decisions/2026-05-14-webui-simulated-onboarded-posture.md`):
// graceful degradation, transparency over completeness, retirable
// compensation. Full fidelity is tracked in tmai-core#381.

import { useState } from "react";
import { useApproaches } from "@/hooks/useApproaches";
import type { ApproachWire, RepoApproachesWire, ReviewTriggerWire } from "@/lib/api";

interface ActiveApproachesSectionProps {
  unitName: string | null;
}

export function ActiveApproachesSection({ unitName }: ActiveApproachesSectionProps) {
  const { data, loading, error } = useApproaches(unitName);

  return (
    <section>
      <header className="mb-2 flex items-baseline gap-2">
        <span className="text-base text-cyan-400">▣</span>
        <h3 className="text-sm font-semibold text-zinc-200">Active approaches</h3>
        {loading && data === null && <span className="text-[10px] text-zinc-500">loading…</span>}
      </header>
      <Body unitName={unitName} data={data} loading={loading} error={error} />
    </section>
  );
}

interface BodyProps {
  unitName: string | null;
  data: ReturnType<typeof useApproaches>["data"];
  loading: boolean;
  error: Error | null;
}

function Body({ unitName, data, loading, error }: BodyProps) {
  if (unitName === null) {
    return (
      <div className="pl-6 text-xs text-zinc-500">
        <p>
          Pick a project (a unit chip in <span className="text-zinc-400">⬢ Cross-unit status</span>{" "}
          above, or the sidebar) to see its active approaches awaiting a verdict.
        </p>
      </div>
    );
  }

  if (error !== null) {
    return (
      <div className="pl-6 text-xs text-red-300/80">
        <p>
          Failed to load approaches: <code className="text-red-300">{error.message}</code>
        </p>
        <p className="mt-1 text-zinc-500">
          Browse <code className="text-zinc-300">doc/approaches/</code> directly in the repo as a
          fallback.
        </p>
      </div>
    );
  }

  if (data === null && loading) {
    return <div className="pl-6 text-xs text-zinc-500">Loading…</div>;
  }

  if (data === null || data.repos.length === 0) {
    return (
      <div className="pl-6 text-xs text-zinc-500">
        <p>
          No active approaches for <code className="text-zinc-300">{unitName}</code>. The unit
          either has no <code className="text-zinc-300">doc/approaches/</code> directory yet, or no
          record is <code className="text-zinc-300">status: active</code>.
        </p>
      </div>
    );
  }

  const onlyPrimary = data.repos.length === 1;

  return (
    <div className="space-y-3 pl-6 text-xs">
      {data.repos.map((repo) => (
        <RepoGroup key={repo.repo_root} repo={repo} singleRepo={onlyPrimary} />
      ))}
      {onlyPrimary && (
        // TODO(tmai-core#340): retire once multi-repo unit support surfaces
        // approaches from every repo (same axis as the decisions side).
        <p className="text-[11px] text-zinc-600">
          Showing this unit's primary repo only — multi-repo approach aggregation isn't wired yet
          (tmai-core#340).
        </p>
      )}
    </div>
  );
}

type Band = "verdict" | "watch" | "quiet";

interface Classified {
  approach: ApproachWire;
  band: Band;
  /** Why it landed in this band — shown so the routing is legible. */
  reason: string;
  /** True when the approach carries a trigger only the engine can
   *  resolve; surfaced honestly rather than guessed (tmai-core#381). */
  coreOnly: boolean;
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function withinDays(isoDate: string, days: number): boolean {
  const then = new Date(`${isoDate}T00:00:00Z`).getTime();
  if (Number.isNaN(then)) return false;
  const now = Date.now();
  return then > now && then - now <= days * 86_400_000;
}

const CORE_ONLY_KINDS: ReadonlySet<ReviewTriggerWire["kind"]> = new Set([
  "pr-closed",
  "pr-merged",
  "issue-closed",
  "decision-status",
  "approach-status",
  "manual",
]);

function classify(a: ApproachWire): Classified {
  const today = isoToday();
  const dateTriggers = a.review_triggers.filter(
    (t): t is Extract<ReviewTriggerWire, { kind: "date" }> => t.kind === "date",
  );
  const fired = dateTriggers.find((t) => t.value <= today);
  const imminent = dateTriggers.find((t) => withinDays(t.value, 30));
  const coreOnly = a.review_triggers.some((t) => CORE_ONLY_KINDS.has(t.kind));

  if (fired) {
    return {
      approach: a,
      band: "verdict",
      reason: `trigger fired: date ${fired.value} has passed`,
      coreOnly,
    };
  }
  if (a.confidence === "low") {
    return { approach: a, band: "watch", reason: "Producer confidence: low", coreOnly };
  }
  if (imminent) {
    return {
      approach: a,
      band: "watch",
      reason: `date trigger ${imminent.value} is within 30 days`,
      coreOnly,
    };
  }
  if (coreOnly) {
    return {
      approach: a,
      band: "watch",
      reason: "trigger needs engine eval (PR / issue / decision-status / manual)",
      coreOnly,
    };
  }
  return { approach: a, band: "quiet", reason: "running — no near trigger", coreOnly };
}

function RepoGroup({ repo, singleRepo }: { repo: RepoApproachesWire; singleRepo: boolean }) {
  const classified = repo.active.map(classify);
  const verdict = classified.filter((c) => c.band === "verdict");
  const watch = classified.filter((c) => c.band === "watch");
  const quiet = classified.filter((c) => c.band === "quiet");
  const coreOnlyCount = classified.filter((c) => c.coreOnly).length;

  return (
    <div className="space-y-2">
      {!singleRepo && (
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
          <code className="font-mono text-zinc-300">{repo.repo_label}</code>
          {repo.primary && <span className="ml-1 text-cyan-400">(primary)</span>}
          {repo.repo_head && <span className="ml-2 text-zinc-600">@ {repo.repo_head}</span>}
        </h4>
      )}

      <p className="text-[11px] text-zinc-600">
        {`${repo.active.length} active · `}
        <span className="text-zinc-500">{`⚡ ${verdict.length}  🟡 ${watch.length}  ⚪ ${quiet.length}`}</span>
      </p>

      <VerdictBand items={verdict} />
      <CollapsibleBand label="🟡 Watch" items={watch} />
      <CollapsibleBand label="⚪ Running quietly" items={quiet} muted />

      <p className="text-[10.5px] leading-relaxed text-zinc-600">
        ⚡ groups approaches whose review-trigger objectively fired (a date passed). Whether each
        verdict is <span className="text-zinc-500">yours</span> or Producer-resolvable needs engine
        eval — tmai-core#381.
        {coreOnlyCount > 0 && (
          <>
            {" "}
            {coreOnlyCount} carr{coreOnlyCount === 1 ? "ies" : "y"} triggers only the engine can
            evaluate (shown under Watch until tmai-core#381).
          </>
        )}{" "}
        Settled (validated / rejected / replaced) approaches are audit-trail and not on the wire yet
        (tmai-core#381).
      </p>
    </div>
  );
}

function VerdictBand({ items }: { items: Classified[] }) {
  if (items.length === 0) {
    return (
      <p className="rounded border border-zinc-700/40 bg-zinc-800/30 px-2 py-1 text-[11px] text-zinc-500">
        ⚡ No verdict due — no active approach has a fired date trigger.
      </p>
    );
  }
  return (
    <div className="rounded border border-amber-500/30 bg-amber-500/[0.05] p-2">
      <p className="mb-1 text-[11px] font-semibold text-amber-300">
        ⚡ Your verdict ({items.length})
      </p>
      <ul className="space-y-2 pl-1">
        {items.map((c) => (
          <li key={c.approach.slug} className="text-[11px] leading-snug">
            <code className="text-zinc-200">{c.approach.slug}</code>
            <span className="text-zinc-500"> — {c.approach.title}</span>
            <div className="text-amber-300/90">{c.reason}</div>
            <div className="text-zinc-500">
              serves: <span className="text-zinc-400">{c.approach.serves.join(", ")}</span>
            </div>
            <div className="text-zinc-500">
              ✓ <span className="text-zinc-400">{c.approach.success_signal}</span>
            </div>
            <div className="text-zinc-500">
              ✗ <span className="text-zinc-400">{c.approach.failure_signal}</span>
            </div>
            {c.coreOnly && (
              <div className="text-[10.5px] text-zinc-600">
                also carries an engine-only trigger (tmai-core#381)
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function CollapsibleBand({
  label,
  items,
  muted,
}: {
  label: string;
  items: Classified[];
  muted?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center gap-1 text-left text-[11px] ${muted ? "text-zinc-600" : "text-zinc-400"} hover:text-zinc-200`}
      >
        <span className="font-mono text-zinc-600">{open ? "▾" : "▸"}</span>
        <span className="font-medium">{label}</span>
        <span className="text-zinc-600">({items.length})</span>
      </button>
      {open && (
        <ul className="space-y-1 pl-4">
          {items.map((c) => (
            <li key={c.approach.slug} className="text-[11px] leading-snug text-zinc-400">
              <code className="text-zinc-300">{c.approach.slug}</code>
              <span className="text-zinc-500"> — {c.approach.title}</span>
              <div className="text-[10.5px] text-zinc-600">{c.reason}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
