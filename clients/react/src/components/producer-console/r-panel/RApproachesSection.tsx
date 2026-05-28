// ▣ Approaches — R panel's raw approach inventory.
//
// Status group → date desc within. The status order is `running`,
// `ready`, `planned`, `partial`, `validated`, `rejected`, `replaced`
// — but R deliberately
// drops the verification-debt gauge and the status-pill filter
// chips (those are appraisal surfaces, see the approach's negative
// space rules). R = inventory; the operator reads the list, tmai
// does not weight it.
//
// Count fact = total approaches running (the same number the gauge
// would show), but rendered as plain `text-subtle-foreground` so
// the header carries zero severity meaning.

import { useApproaches } from "@/hooks/useApproaches";
import type { ApproachStatus, ApproachWire, RepoApproachesWire } from "@/lib/api";
import { Section } from "./Section";

interface RApproachesSectionProps {
  unitName: string | null;
  expanded: boolean;
  onToggle: () => void;
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

export function RApproachesSection({ unitName, expanded, onToggle }: RApproachesSectionProps) {
  const { data, loading, error } = useApproaches(unitName);
  const running =
    data === null
      ? 0
      : data.repos.reduce(
          (n, r) => n + r.approaches.filter((a) => a.status === "running").length,
          0,
        );

  return (
    <Section
      id="approaches"
      glyph="▣"
      label="Approaches"
      count={`${running} running`}
      expanded={expanded}
      onToggle={onToggle}
    >
      <Body unitName={unitName} repos={data?.repos ?? null} loading={loading} error={error} />
    </Section>
  );
}

interface BodyProps {
  unitName: string | null;
  repos: RepoApproachesWire[] | null;
  loading: boolean;
  error: Error | null;
}

function Body({ unitName, repos, loading, error }: BodyProps) {
  if (unitName === null) {
    return <p className="text-subtle-foreground">Pick a project to see approaches.</p>;
  }
  if (error !== null) {
    return <p className="text-muted-foreground">Failed to load approaches: {error.message}</p>;
  }
  if (repos === null && loading) {
    return <p className="text-subtle-foreground">Loading…</p>;
  }
  if (repos === null || repos.length === 0) {
    return <p className="text-subtle-foreground">No approaches.</p>;
  }
  const multiRepo = repos.length > 1;
  return (
    <div className="space-y-2">
      {repos.map((repo) => (
        <RepoBlock key={repo.repo_root} repo={repo} multiRepo={multiRepo} />
      ))}
    </div>
  );
}

function RepoBlock({ repo, multiRepo }: { repo: RepoApproachesWire; multiRepo: boolean }) {
  // Group by status then sort by date desc within each group. No
  // filter chips — every status is shown, every item is rendered.
  const byStatus = new Map<ApproachStatus, ApproachWire[]>();
  for (const a of repo.approaches) {
    const list = byStatus.get(a.status) ?? [];
    list.push(a);
    byStatus.set(a.status, list);
  }
  for (const [, list] of byStatus) {
    list.sort((a, b) => b.date.localeCompare(a.date));
  }
  return (
    <div>
      {multiRepo && (
        <p className="text-[11px] uppercase tracking-wide text-subtle-foreground">
          {repo.repo_label}
        </p>
      )}
      {STATUS_ORDER.map((status) => {
        const list = byStatus.get(status);
        if (!list || list.length === 0) return null;
        return (
          <div key={status} className="mt-1">
            <p className="text-[11px] uppercase tracking-wide text-subtle-foreground">
              {status} ({list.length})
            </p>
            <ul className="space-y-0.5">
              {list.map((a) => (
                <li key={a.slug} className="leading-snug">
                  <span className="font-mono text-subtle-foreground">{a.date}</span>{" "}
                  <span className="text-foreground">{a.title}</span>
                  <div className="text-[11px] text-subtle-foreground">{a.slug}</div>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
