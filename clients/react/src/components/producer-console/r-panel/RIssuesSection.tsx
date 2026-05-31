// 📋 Issues — R panel's raw issue inventory (R₁).
//
// Fetches via `useIssues(repoPath)` because no unit-scoped issues
// endpoint exists yet (PRs have one — issues don't). R keeps issues
// scoped to the currently-focused repo path; multi-repo aggregation
// belongs upstream (see the approach's defer list).
//
// A row click opens the issue in the R₂ viewer column (`RIssueViewer`),
// mirroring `RPrsSection`'s `onSelectPr` / `selectedKey` / `aria-current`
// exactly — the github.com link-out that used to live on the issue number
// is gone; the issue's full content is reviewed in-tmai with no
// round-trip. R₁ stays a pure inventory; the row is just a select.

import { useIssues } from "@/hooks/useIssues";
import type { IssueInfo } from "@/lib/api";
import { type SelectedIssue, selectedIssueKey } from "./r-viewer/RIssueViewer";
import { Section } from "./Section";

interface RIssuesSectionProps {
  currentProjectPath: string | null;
  expanded: boolean;
  onToggle: () => void;
  /** Open an issue in the R₂ viewer column. Optional so the section still
   *  renders standalone (e.g. in isolation tests). */
  onSelectIssue?: (sel: SelectedIssue) => void;
  /** `selectedIssueKey(repoPath, number)` of the issue currently open in
   *  R₂, so the row marks itself as the one being viewed (a mechanical
   *  "open here" fact, not appraisal). */
  selectedKey?: string | null;
}

// The repo label rides into the R₂ selection so the viewer header reads
// identically to the PR / record viewers. Issues carry no repo_label on
// the wire (they are per-repo, not unit-scoped), so it is derived from the
// project path basename — the same derivation App uses for `unitName`.
//
// Must NEVER return "" (a blank header reads as broken). `filter(Boolean)`
// drops empty segments so a trailing slash still yields the basename; when
// there is no non-empty segment at all (path is "", whitespace, or only
// slashes) we fall back to the trimmed path, or a non-empty placeholder.
function repoLabelOf(path: string): string {
  const trimmed = path.trim();
  const parts = trimmed.split("/").filter(Boolean);
  if (parts.length > 0) return parts[parts.length - 1];
  return trimmed || "<unknown>";
}

export function RIssuesSection({
  currentProjectPath,
  expanded,
  onToggle,
  onSelectIssue,
  selectedKey,
}: RIssuesSectionProps) {
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
      <Body
        currentProjectPath={currentProjectPath}
        items={open}
        loading={loading}
        error={error}
        onSelectIssue={onSelectIssue}
        selectedKey={selectedKey ?? null}
      />
    </Section>
  );
}

interface BodyProps {
  currentProjectPath: string | null;
  items: IssueInfo[] | null;
  loading: boolean;
  error: Error | null;
  onSelectIssue?: (sel: SelectedIssue) => void;
  selectedKey: string | null;
}

function Body({
  currentProjectPath,
  items,
  loading,
  error,
  onSelectIssue,
  selectedKey,
}: BodyProps) {
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
  const repoLabel = repoLabelOf(currentProjectPath);
  return (
    <ul className="space-y-1">
      {items.map((i) => (
        <IssueRow
          key={i.number}
          issue={i}
          repoPath={currentProjectPath}
          repoLabel={repoLabel}
          onSelectIssue={onSelectIssue}
          selected={selectedKey === selectedIssueKey(currentProjectPath, i.number)}
        />
      ))}
    </ul>
  );
}

function IssueRow({
  issue,
  repoPath,
  repoLabel,
  onSelectIssue,
  selected,
}: {
  issue: IssueInfo;
  repoPath: string;
  repoLabel: string;
  onSelectIssue?: (sel: SelectedIssue) => void;
  selected: boolean;
}) {
  // The whole row is a button that opens the issue in the R₂ viewer —
  // there is NO github.com link-out anymore; the issue's full content is
  // reviewed in-tmai. `aria-current` marks the row whose content is
  // currently open in R₂ (a mechanical "open here" fact, not appraisal).
  return (
    <li className="leading-snug">
      <button
        type="button"
        onClick={() => onSelectIssue?.({ repoPath, repoLabel, issue })}
        aria-current={selected ? "true" : undefined}
        className={`w-full rounded px-1 py-0.5 text-left transition-colors hover:bg-surface-strong/40 ${
          selected ? "bg-surface-strong/40" : ""
        }`}
      >
        <span>
          <span className="font-mono text-foreground">#{issue.number}</span>{" "}
          <span className="text-foreground">{issue.title}</span>
        </span>
        <div className="text-[11px] text-subtle-foreground">
          {issue.state.toLowerCase()}
          {issue.labels.length > 0 && ` · ${issue.labels.map((l) => l.name).join(", ")}`}
        </div>
      </button>
    </li>
  );
}
