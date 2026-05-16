// ⬡ Settled decisions — third hand-over section, wired to
// `GET /api/units/{unit}/decisions` (tmai-core PR #359).
//
// Surfaces the same Settled-section the Producer reads on session-start:
// 📌 Foundations / 🔴 In-play / 🟡 Warm / ⚪ Cold buckets, plus the
// ⚠ Currency sweep + ⚠ Trajectory check due callouts. The render is
// shaped to match the markdown hand-over the Producer composes
// (`tmai-core/crates/tmai-core/src/workbench/render.rs`) so the
// operator's mental model is the same on both sides.
//
// Multi-repo unit (per
// `doc/decisions/2026-05-14-producer-capability-valve-principle.md` §D)
// is rendered as one group per repo. Single-repo unit collapses to one
// group. The simulated-onboarded posture
// (`doc/decisions/2026-05-14-webui-simulated-onboarded-posture.md`)
// keeps the "single-repo only" caveat honest until tmai-core#340 lands.
//
// `unit = null` → "pick a project first" placeholder, no fetch. Per the
// posture DR's transparency principle, we never fabricate decisions —
// an empty unit or a load error reads as "no decisions yet" rather
// than an empty bucketed render that looks like the unit has nothing
// settled.
//
// TODO(tmai-core#340): when `UnitConfig.also[]` lands, surface decisions
// from every repo in the unit. The response already groups per repo;
// only the "Showing one unit only" caveat needs to retire then.

import { useState } from "react";
import { useDecisions } from "@/hooks/useDecisions";
import type {
  CurrencyItemWire,
  DecisionWire,
  FoundationalDueWire,
  RepoDecisionsWire,
} from "@/lib/api";

interface SettledDecisionsSectionProps {
  unitName: string | null;
}

export function SettledDecisionsSection({ unitName }: SettledDecisionsSectionProps) {
  const { data, loading, error } = useDecisions(unitName);

  return (
    <section>
      <header className="mb-2 flex items-baseline gap-2">
        <span className="text-base text-primary">⬡</span>
        <h3 className="text-sm font-semibold text-foreground">Settled decisions</h3>
        {loading && data === null && (
          <span className="text-[10px] text-muted-foreground">loading…</span>
        )}
      </header>
      <SettledBody unitName={unitName} data={data} loading={loading} error={error} />
    </section>
  );
}

interface SettledBodyProps {
  unitName: string | null;
  data: ReturnType<typeof useDecisions>["data"];
  loading: boolean;
  error: Error | null;
}

function SettledBody({ unitName, data, loading, error }: SettledBodyProps) {
  if (unitName === null) {
    return (
      <div className="pl-6 text-xs text-muted-foreground">
        <p>
          Pick a project (click a unit chip in{" "}
          <span className="text-muted-foreground">⬢ Cross-unit status</span> above, or use the
          sidebar) to see its settled decisions.
        </p>
      </div>
    );
  }

  if (error !== null) {
    return (
      <div className="pl-6 text-xs text-destructive/80">
        <p>
          Failed to load decisions: <code className="text-destructive">{error.message}</code>
        </p>
        <p className="mt-1 text-muted-foreground">
          Browse <code className="text-foreground">doc/decisions/</code> directly in the repo as a
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
          No decisions resolved for <code className="text-foreground">{unitName}</code>. The unit
          either has no <code className="text-foreground">doc/decisions/</code> directory yet, or
          it's empty.
        </p>
      </div>
    );
  }

  // Posture (per `2026-05-14-webui-simulated-onboarded-posture.md`):
  // until `UnitConfig.also[]` (tmai-core#340) lands, the response will
  // always have `repos.length === 1` for a real-world tmai project that
  // spans multiple repos. Surface this honestly so the operator knows
  // the section is currently showing the primary cwd only.
  const onlyPrimary = data.repos.length === 1;

  return (
    <div className="space-y-3 pl-6 text-xs">
      {data.repos.map((repo) => (
        <RepoGroup key={repo.repo_root} repo={repo} singleRepo={onlyPrimary} />
      ))}
      {onlyPrimary && (
        // TODO(tmai-core#340): retire this notice once multi-repo
        // unit support surfaces decisions from every repo.
        <p className="text-[11px] text-subtle-foreground">
          Showing this unit's primary repo only — multi-repo decision aggregation isn't wired yet
          (tmai-core#340).
        </p>
      )}
    </div>
  );
}

interface RepoGroupProps {
  repo: RepoDecisionsWire;
  singleRepo: boolean;
}

function RepoGroup({ repo, singleRepo }: RepoGroupProps) {
  const { counts } = repo;
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
        {`${counts.total} decision${counts.total !== 1 ? "s" : ""} · `}
        <span className="text-muted-foreground">{`📌 ${counts.foundations}  🔴 ${counts.in_play}  🟡 ${counts.warm}  ⚪ ${counts.cold}`}</span>
        {counts.superseded > 0 && (
          <span className="text-subtle-foreground">{` · superseded ${counts.superseded}`}</span>
        )}
      </p>

      {repo.currency_sweep.length > 0 && <CurrencySweep items={repo.currency_sweep} />}

      {repo.foundational_due.length > 0 && <FoundationalDue items={repo.foundational_due} />}

      <Bucket label="📌 Foundations" items={repo.foundations} alwaysOpen />
      <Bucket label="🔴 In play" items={repo.in_play} alwaysOpen />
      <Bucket label="🟡 Warm" items={repo.warm} />
      <Bucket label="⚪ Cold" items={repo.cold} />
      <Bucket label="Superseded" items={repo.superseded} muted />
    </div>
  );
}

interface BucketProps {
  label: string;
  items: DecisionWire[];
  /** Render the list expanded by default (foundations / in-play). */
  alwaysOpen?: boolean;
  muted?: boolean;
}

function Bucket({ label, items, alwaysOpen, muted }: BucketProps) {
  const [open, setOpen] = useState(alwaysOpen === true);
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
        <ul className="space-y-0.5 pl-4">
          {items.map((d) => (
            <DecisionRow key={d.slug} decision={d} />
          ))}
        </ul>
      )}
    </div>
  );
}

function DecisionRow({ decision }: { decision: DecisionWire }) {
  const driftMark = decision.stale_since ? " ⚠" : "";
  const contractMark = decision.contract_surface ? " [contract]" : "";
  return (
    <li className="text-[11px] leading-snug text-muted-foreground">
      <code className="text-foreground">{decision.slug}</code>
      <span className="text-subtle-foreground">{contractMark}</span>
      <span className="text-warning">{driftMark}</span>
      <span className="text-muted-foreground"> — {decision.title}</span>
    </li>
  );
}

function CurrencySweep({ items }: { items: CurrencyItemWire[] }) {
  return (
    <div className="rounded border border-warning/20 bg-warning/[0.04] p-2">
      <p className="mb-1 text-[11px] font-medium text-warning">⚠ Currency sweep ({items.length})</p>
      <ul className="space-y-1 pl-3">
        {items.map((it) => (
          <li key={it.slug} className="text-[11px] text-muted-foreground">
            <code className="text-foreground">{it.slug}</code>
            <span className="text-muted-foreground"> — {it.title}</span>
            <div className="text-[10.5px] text-muted-foreground">{it.remedy}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FoundationalDue({ items }: { items: FoundationalDueWire[] }) {
  return (
    <div className="rounded border border-warning/20 bg-warning/[0.04] p-2">
      <p className="mb-1 text-[11px] font-medium text-warning">
        ⚠ Trajectory check due ({items.length})
      </p>
      <ul className="space-y-1 pl-3">
        {items.map((it) => (
          <li key={it.slug} className="text-[11px] text-muted-foreground">
            <code className="text-foreground">{it.slug}</code>
            <span className="text-muted-foreground"> — {it.title}</span>
            <div className="text-[10.5px] text-muted-foreground">
              {it.age_days}d since verify · {it.remedy}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
