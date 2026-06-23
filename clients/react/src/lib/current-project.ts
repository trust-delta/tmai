// Whether the selected `currentProject` still belongs to a LIVE project.
//
// App's auto-default effect resets `currentProject` to `projectPaths[0]`
// whenever the selection no longer belongs to a live project (so a stale cwd is
// never sent on X-Tmai-Origin once its agents stop). The naive
// `projectPaths.includes(currentProject)` membership is too strict for the
// live-slot aim-console: a MULTI-REPO unit's Producer runs at the unit's
// WRAPPER directory (e.g. `/works/tmai`, which is the agent-derived
// `projectPath`), while selecting that unit's tab sets `currentProject` to the
// unit's PRIMARY repo (`/works/tmai/tmai`, a DESCENDANT of the wrapper). The
// descendant is not a literal `projectPaths` member, so the strict check reset
// the explicit tab selection to `projectPaths[0]` — bouncing to the WRONG unit
// once a second unit was live (#581 dogfood: "launching another unit makes tmai
// unreachable; killing it returns").
//
// Tree-tolerant fix: `currentProject` belongs to a live project when it equals
// a `projectPath` OR shares that unit's tree — an ancestor or descendant of one.
// The trailing-`/` boundary prevents a sibling-prefix false match
// (`/works/tmai` vs `/works/tmai-extra`). A genuinely stale path (no tree
// relationship to any live project) still fails and is reset, as before.
export function currentProjectBelongsToLiveProject(
  currentProject: string,
  projectPaths: string[],
): boolean {
  return projectPaths.some(
    (p) =>
      p === currentProject ||
      currentProject.startsWith(`${p}/`) ||
      p.startsWith(`${currentProject}/`),
  );
}
