// ⬡ Decisions — R panel's raw decision inventory.
//
// Flat chronological list by `last_verified` desc. Deliberately NOT
// bucketed by temperature (`foundations` / `in_play` / `warm` / `cold`)
// — that's C's `SettledDecisionsSection`'s briefing-layer
// responsibility. R is raw inventory: plain ordering, no tmai-side
// appraisal. See the approach's R section table.

import { useDecisions } from "@/hooks/useDecisions";
import type { DecisionWire, RepoDecisionsWire } from "@/lib/api";
import { Section } from "./Section";

interface RDecisionsSectionProps {
  unitName: string | null;
  expanded: boolean;
  onToggle: () => void;
}

export function RDecisionsSection({ unitName, expanded, onToggle }: RDecisionsSectionProps) {
  const { data, loading, error } = useDecisions(unitName);
  const total = data === null ? 0 : data.repos.reduce((n, r) => n + flattenAll(r).length, 0);

  return (
    <Section
      id="decisions"
      glyph="⬡"
      label="Decisions"
      count={`${total}`}
      expanded={expanded}
      onToggle={onToggle}
    >
      <Body unitName={unitName} repos={data?.repos ?? null} loading={loading} error={error} />
    </Section>
  );
}

function flattenAll(repo: RepoDecisionsWire): DecisionWire[] {
  return [...repo.foundations, ...repo.in_play, ...repo.warm, ...repo.cold, ...repo.superseded];
}

interface BodyProps {
  unitName: string | null;
  repos: RepoDecisionsWire[] | null;
  loading: boolean;
  error: Error | null;
}

function Body({ unitName, repos, loading, error }: BodyProps) {
  if (unitName === null) {
    return <p className="text-subtle-foreground">Pick a project to see decisions.</p>;
  }
  if (error !== null) {
    return <p className="text-muted-foreground">Failed to load decisions: {error.message}</p>;
  }
  if (repos === null && loading) {
    return <p className="text-subtle-foreground">Loading…</p>;
  }
  if (repos === null || repos.length === 0 || repos.every((r) => flattenAll(r).length === 0)) {
    return <p className="text-subtle-foreground">No decisions.</p>;
  }
  const multiRepo = repos.length > 1;
  return (
    <div className="space-y-2">
      {repos.map((repo) => {
        const sorted = [...flattenAll(repo)].sort((a, b) =>
          b.last_verified.localeCompare(a.last_verified),
        );
        if (sorted.length === 0) return null;
        return (
          <div key={repo.repo_root}>
            {multiRepo && (
              <p className="text-[11px] uppercase tracking-wide text-subtle-foreground">
                {repo.repo_label}
              </p>
            )}
            <ul className="space-y-0.5">
              {sorted.map((d) => (
                <li key={d.slug} className="leading-snug">
                  <span className="font-mono text-subtle-foreground">{d.last_verified}</span>{" "}
                  <span className="text-foreground">{d.title}</span>
                  <div className="text-[11px] text-subtle-foreground">
                    {d.slug} · {d.status}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
