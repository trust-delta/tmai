// ▤ All approaches — operator dashboard's task-selection surface, sibling
// to `▣ Running approaches` (the verdict-inbox).
//
// Per tmai-core#462 Amendment 2026-05-28's dashboard 全件可視化
// direction, the wire (tmai-core#463 → tmai#744) carries every approach
// record in `RepoApproachesWire.approaches` regardless of status:
// `Planned` / `Partial` / `Ready` / `Running` / `Validated` / `Rejected`
// / `Replaced`. tmai does NOT filter or sort authoritatively — the
// operator filters/sorts client-side here.
//
// Axes (kept distinct so the surfaces stay honest):
//   • Verdict-inbox  (▣ Running approaches above) — verification axis,
//     `status: running` only. The verification-debt gauge counts those.
//   • Task-selection (this section)              — "what should we work
//     on next" across all 7 statuses.
//
// Reuses the same `useApproaches(unitName)` payload as the section above
// — both feed off the one fetch.
//
// Default ordering = the wire's order (most-recent-first by slug per
// `RepoApproachesWire`). The status filter is client-side; default
// all-on; toggling chips hides statuses the operator does not care
// about. The verification gauge counts `status: running` ONLY per
// tmai-core#462 body ("running を直接 count、ready/planned/partial は
// 混ぜない") — do not blend other statuses into the verification number.

import { useMemo, useState } from "react";
import { useApproaches } from "@/hooks/useApproaches";
import type { ApproachStatus, ApproachWire, RepoApproachesWire } from "@/lib/api";

interface AllApproachesSectionProps {
  unitName: string | null;
}

const STATUS_ORDER: readonly ApproachStatus[] = [
  "running",
  "ready",
  "planned",
  "partial",
  "validated",
  "rejected",
  "replaced",
];

export function AllApproachesSection({ unitName }: AllApproachesSectionProps) {
  const { data, loading, error } = useApproaches(unitName);

  return (
    <section>
      <header className="mb-2 flex items-baseline gap-2">
        <span className="text-base text-primary">▤</span>
        <h3 className="text-sm font-semibold text-foreground">All approaches</h3>
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
          to see its full approach roster across every status.
        </p>
      </div>
    );
  }

  if (error !== null) {
    // The sibling section already surfaces the error verbatim; keep the
    // dashboard surface quiet on the same fetch failure rather than
    // double-alarming the operator.
    return null;
  }

  if (data === null && loading) {
    return <div className="pl-6 text-xs text-muted-foreground">Loading…</div>;
  }

  if (data === null || data.repos.length === 0) {
    return (
      <div className="pl-6 text-xs text-muted-foreground">
        <p>
          No approaches for <code className="text-foreground">{unitName}</code> yet.
        </p>
      </div>
    );
  }

  return <DashboardBody repos={data.repos} />;
}

function DashboardBody({ repos }: { repos: RepoApproachesWire[] }) {
  // Default = all statuses visible. Operator toggles statuses they do
  // not care about off — client-side, no refetch.
  const [hidden, setHidden] = useState<ReadonlySet<ApproachStatus>>(() => new Set());

  const toggle = (s: ApproachStatus) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  };

  // Verification-debt gauge across the unit = running count only. Do
  // NOT mix planned/partial/ready into this number (tmai-core#462).
  const runningCount = useMemo(
    () =>
      repos.reduce(
        (total, repo) => total + repo.approaches.filter((a) => a.status === "running").length,
        0,
      ),
    [repos],
  );

  // Per-status totals across the unit, for the filter chips' counts
  // and the operator's at-a-glance shape sense.
  const totalsByStatus = useMemo(() => {
    const m = new Map<ApproachStatus, number>();
    for (const s of STATUS_ORDER) m.set(s, 0);
    for (const repo of repos) {
      for (const a of repo.approaches) {
        m.set(a.status, (m.get(a.status) ?? 0) + 1);
      }
    }
    return m;
  }, [repos]);

  return (
    <div className="space-y-3 pl-6 text-xs">
      <Gauge runningCount={runningCount} />
      <StatusFilter totalsByStatus={totalsByStatus} hidden={hidden} onToggle={toggle} />
      <div className="space-y-3">
        {repos.map((repo) => (
          <RepoBlock
            key={repo.repo_root}
            repo={repo}
            hidden={hidden}
            singleRepo={repos.length === 1}
          />
        ))}
      </div>
    </div>
  );
}

function Gauge({ runningCount }: { runningCount: number }) {
  return (
    <p
      // The verification-debt gauge counts `status: running` ONLY per
      // tmai-core#462 body ("running を直接 count、ready/planned/partial
      // は混ぜない"). Other statuses are visible below but excluded here.
      data-testid="verification-gauge"
      className="rounded border border-hairline-strong/40 bg-surface-strong/30 px-2 py-1 text-[11px] text-muted-foreground"
    >
      Verification debt: <span className="text-foreground">{runningCount}</span> running
    </p>
  );
}

interface StatusFilterProps {
  totalsByStatus: ReadonlyMap<ApproachStatus, number>;
  hidden: ReadonlySet<ApproachStatus>;
  onToggle: (s: ApproachStatus) => void;
}

function StatusFilter({ totalsByStatus, hidden, onToggle }: StatusFilterProps) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
      <span className="text-subtle-foreground">filter:</span>
      {STATUS_ORDER.map((s) => {
        const total = totalsByStatus.get(s) ?? 0;
        const active = !hidden.has(s);
        const pill = pillClasses(s, active);
        return (
          <button
            key={s}
            type="button"
            onClick={() => onToggle(s)}
            aria-pressed={active}
            className={`${pill} rounded-full border px-2 py-0.5 transition-colors`}
          >
            {s} {total}
          </button>
        );
      })}
    </div>
  );
}

interface RepoBlockProps {
  repo: RepoApproachesWire;
  hidden: ReadonlySet<ApproachStatus>;
  singleRepo: boolean;
}

function RepoBlock({ repo, hidden, singleRepo }: RepoBlockProps) {
  const visible = repo.approaches.filter((a) => !hidden.has(a.status));

  return (
    <div className="space-y-1.5">
      {!singleRepo && (
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <code className="font-mono text-foreground">{repo.repo_label}</code>
          {repo.primary && <span className="ml-1 text-primary">(primary)</span>}
          {repo.repo_head && (
            <span className="ml-2 text-subtle-foreground">@ {repo.repo_head}</span>
          )}
        </h4>
      )}
      {visible.length === 0 ? (
        <p className="text-[11px] text-subtle-foreground">All statuses filtered out.</p>
      ) : (
        <ul className="space-y-1">
          {visible.map((a) => (
            <ApproachRow key={a.slug} approach={a} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ApproachRow({ approach }: { approach: ApproachWire }) {
  return (
    <li className="flex items-baseline gap-2 text-[11px] leading-snug">
      <StatusPill status={approach.status} />
      <code className="text-foreground">{approach.slug}</code>
      <span className="text-muted-foreground">— {approach.title}</span>
      {approach.confidence !== null && (
        <span className="text-subtle-foreground">· conf {approach.confidence}</span>
      )}
    </li>
  );
}

function StatusPill({ status }: { status: ApproachStatus }) {
  return (
    <span className={`${pillClasses(status, true)} rounded-full border px-1.5 py-0.5 text-[10px]`}>
      {status}
    </span>
  );
}

// Semantic-token mapping — never raw Tailwind palette per
// `no-raw-palette.test.ts`. Active = filled tint, inactive = muted/
// hairline so the operator can see which statuses are toggled off
// without losing the row's status identity.
function pillClasses(status: ApproachStatus, active: boolean): string {
  if (!active) {
    return "border-hairline bg-transparent text-subtle-foreground hover:text-muted-foreground";
  }
  switch (status) {
    case "running":
      return "border-warning/40 bg-warning/[0.08] text-warning";
    case "ready":
      return "border-primary/40 bg-primary/[0.08] text-primary";
    case "validated":
      return "border-success/40 bg-success/[0.08] text-success";
    case "rejected":
      return "border-destructive/40 bg-destructive/[0.08] text-destructive";
    case "replaced":
      return "border-hairline-strong/50 bg-surface-strong/40 text-muted-foreground";
    case "planned":
    case "partial":
      return "border-hairline-strong/50 bg-surface-strong/30 text-foreground";
  }
}
