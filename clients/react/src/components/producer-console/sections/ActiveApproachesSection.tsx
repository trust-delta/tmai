// ▣ Running approaches — the Producer console's Verdict-inbox, wired to
// `GET /api/units/{unit}/approaches` (tmai-core PR #369).
//
// Essence (deliberately NOT the decisions surface — see
// `doc/decisions/2026-05-16-authority-attaches-to-the-act.md`): a decision
// is a settled commitment the operator attends to when it drifts; an
// approach is a *live experiment with a pending verdict*. So this surface
// triages by "does this need your verdict now?", not by temperature
// buckets. Low-priority bands are collapsed; only ⚡ is open.
//
// The wire (tmai-core#463 / tmai#744) carries ALL statuses; this section
// narrows to `status: "running"` only — the dischargeable verification
// debt (formerly `active`'s role, before the lifecycle split into Ready +
// Running per tmai-core#462 Amendment 2026-05-28). Other statuses
// (Planned / Partial / Ready / Validated / Rejected / Replaced) surface
// in `AllApproachesSection` below as the operator dashboard's
// task-selection axis.
//
// Client-degraded by design (A1). The wire carries no resolved
// trigger/verdict state, so the client can faithfully evaluate only
// `kind: date` triggers (vs today) + `confidence`. Triggers the engine
// must resolve (pr-*/issue-closed/decision-status/approach-status/manual)
// and the human-vs-Producer verdict split are surfaced honestly, never
// fabricated — per the simulated-onboarded posture
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
        <span className="text-base text-primary">▣</span>
        <h3 className="text-sm font-semibold text-foreground">Running approaches</h3>
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
  data: ReturnType<typeof useApproaches>["data"];
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
          to see its running approaches awaiting a verdict.
        </p>
      </div>
    );
  }

  if (error !== null) {
    return (
      <div className="pl-6 text-xs text-destructive/80">
        <p>
          Failed to load approaches: <code className="text-destructive">{error.message}</code>
        </p>
        <p className="mt-1 text-muted-foreground">
          Browse <code className="text-foreground">doc/approaches/</code> directly in the repo as a
          fallback.
        </p>
      </div>
    );
  }

  if (data === null && loading) {
    return <div className="pl-6 text-xs text-muted-foreground">Loading…</div>;
  }

  if (data === null || data.repos.length === 0) {
    return (
      <div className="pl-6 text-xs text-muted-foreground">
        <p>
          No running approaches for <code className="text-foreground">{unitName}</code>. The unit
          either has no <code className="text-foreground">doc/approaches/</code> directory yet, or
          no record is <code className="text-foreground">status: running</code>.
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
        <p className="text-[11px] text-subtle-foreground">
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
  const running = repo.approaches.filter((a) => a.status === "running");
  const classified = running.map(classify);
  const verdict = classified.filter((c) => c.band === "verdict");
  const watch = classified.filter((c) => c.band === "watch");
  const quiet = classified.filter((c) => c.band === "quiet");
  const coreOnlyCount = classified.filter((c) => c.coreOnly).length;

  return (
    <div className="space-y-2">
      {!singleRepo && (
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <code className="font-mono text-foreground">{repo.repo_label}</code>
          {repo.primary && <span className="ml-1 text-primary">(primary)</span>}
          {repo.repo_head && (
            <span className="ml-2 text-subtle-foreground">@ {repo.repo_head}</span>
          )}
        </h4>
      )}

      <p className="text-[11px] text-subtle-foreground">
        {`${running.length} running · `}
        <span className="text-muted-foreground">{`⚡ ${verdict.length}  🟡 ${watch.length}  ⚪ ${quiet.length}`}</span>
      </p>

      <VerdictBand items={verdict} />
      <CollapsibleBand label="🟡 Watch" items={watch} />
      <CollapsibleBand label="⚪ Running quietly" items={quiet} muted />

      <p className="text-[10.5px] leading-relaxed text-subtle-foreground">
        ⚡ groups approaches whose review-trigger objectively fired (a date passed). Whether each
        verdict is <span className="text-muted-foreground">yours</span> or Producer-resolvable needs
        engine eval — tmai-core#381.
        {coreOnlyCount > 0 && (
          <>
            {" "}
            {coreOnlyCount} carr{coreOnlyCount === 1 ? "ies" : "y"} triggers only the engine can
            evaluate (shown under Watch until tmai-core#381).
          </>
        )}{" "}
        Other statuses (planned / partial / ready / validated / rejected / replaced) live in the
        dashboard surface below.
      </p>
    </div>
  );
}

function VerdictBand({ items }: { items: Classified[] }) {
  if (items.length === 0) {
    return (
      <p className="rounded border border-hairline-strong/40 bg-surface-strong/30 px-2 py-1 text-[11px] text-muted-foreground">
        ⚡ No verdict due — no running approach has a fired date trigger.
      </p>
    );
  }
  return (
    <div className="rounded border border-warning/30 bg-warning/[0.05] p-2">
      <p className="mb-1 text-[11px] font-semibold text-warning">
        ⚡ Your verdict ({items.length})
      </p>
      <ul className="space-y-2 pl-1">
        {items.map((c) => (
          <li key={c.approach.slug} className="text-[11px] leading-snug">
            <code className="text-foreground">{c.approach.slug}</code>
            <span className="text-muted-foreground"> — {c.approach.title}</span>
            <div className="text-warning/90">{c.reason}</div>
            <div className="text-muted-foreground">
              serves: <span className="text-muted-foreground">{c.approach.serves.join(", ")}</span>
            </div>
            <div className="text-muted-foreground">
              ✓ <span className="text-muted-foreground">{c.approach.success_signal}</span>
            </div>
            <div className="text-muted-foreground">
              ✗ <span className="text-muted-foreground">{c.approach.failure_signal}</span>
            </div>
            {c.coreOnly && (
              <div className="text-[10.5px] text-subtle-foreground">
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
        className={`flex w-full items-center gap-1 text-left text-[11px] ${muted ? "text-subtle-foreground" : "text-muted-foreground"} hover:text-foreground`}
      >
        <span className="font-mono text-subtle-foreground">{open ? "▾" : "▸"}</span>
        <span className="font-medium">{label}</span>
        <span className="text-subtle-foreground">({items.length})</span>
      </button>
      {open && (
        <ul className="space-y-1 pl-4">
          {items.map((c) => (
            <li key={c.approach.slug} className="text-[11px] leading-snug text-muted-foreground">
              <code className="text-foreground">{c.approach.slug}</code>
              <span className="text-muted-foreground"> — {c.approach.title}</span>
              <div className="text-[10.5px] text-subtle-foreground">{c.reason}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
