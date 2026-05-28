// 📋 Issues — R panel's raw issue inventory.
//
// Fetches via `useIssues(repoPath)` because no unit-scoped issues
// endpoint exists yet (PRs have one — issues don't). R keeps issues
// scoped to the currently-focused repo path; multi-repo aggregation
// belongs upstream (see the approach's defer list).

import { useIssues } from "@/hooks/useIssues";
import type { IssueInfo } from "@/lib/api";
import { Section } from "./Section";

interface RIssuesSectionProps {
  currentProjectPath: string | null;
  expanded: boolean;
  onToggle: () => void;
}

export function RIssuesSection({ currentProjectPath, expanded, onToggle }: RIssuesSectionProps) {
  const { data, loading, error } = useIssues(currentProjectPath);
  // `open` is the load-bearing list — header count AND body rows both
  // read off it. Closed items aren't surfaced in R's issue inventory;
  // the wire only carries open + recent-closed, and "recent closed" is
  // GitHub's concept, not ours. Keeping `null` distinct from `[]`
  // preserves the loading/empty branches in Body.
  const open = data === null ? null : data.filter((i) => i.state.toLowerCase() === "open");

  return (
    <Section
      id="issues"
      glyph="📋"
      label="Issues"
      count={`${open?.length ?? 0} open`}
      expanded={expanded}
      onToggle={onToggle}
    >
      <Body currentProjectPath={currentProjectPath} items={open} loading={loading} error={error} />
    </Section>
  );
}

interface BodyProps {
  currentProjectPath: string | null;
  items: IssueInfo[] | null;
  loading: boolean;
  error: Error | null;
}

function Body({ currentProjectPath, items, loading, error }: BodyProps) {
  if (currentProjectPath === null) {
    return <p className="text-subtle-foreground">Pick a project to see issues.</p>;
  }
  if (error !== null) {
    return <p className="text-muted-foreground">Failed to load issues: {error.message}</p>;
  }
  if (items === null && loading) {
    return <p className="text-subtle-foreground">Loading…</p>;
  }
  if (items === null || items.length === 0) {
    return <p className="text-subtle-foreground">No issues.</p>;
  }
  return (
    <ul className="space-y-1">
      {items.map((i) => (
        <IssueRow key={i.number} issue={i} />
      ))}
    </ul>
  );
}

function IssueRow({ issue }: { issue: IssueInfo }) {
  return (
    <li className="leading-snug">
      <a
        href={issue.url}
        target="_blank"
        rel="noopener noreferrer"
        className="font-mono text-foreground hover:underline"
      >
        #{issue.number}
      </a>{" "}
      <span className="text-foreground">{issue.title}</span>
      <div className="text-[11px] text-subtle-foreground">
        {issue.state.toLowerCase()}
        {issue.labels.length > 0 && ` · ${issue.labels.map((l) => l.name).join(", ")}`}
      </div>
    </li>
  );
}
