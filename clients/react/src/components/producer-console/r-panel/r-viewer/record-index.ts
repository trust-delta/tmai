// Cross-ref index — slug → the `SelectedRecord` that owns it.
//
// Shared by `RRecordViewer` (resolving `serves:` / `[[slug]]` cross-refs in
// a focused record) and `RInventorySection` (resolving an in-play inventory
// row's slug to the full decision/approach so a click can open R₂'s
// `RRecordViewer`). The inventory projection carries only `slug` + `display`,
// so the section re-reads the unit's decisions + approaches (the same cheap
// 60s polls R₁ uses) and resolves each entry through this index — the full
// wire + `repoPath` / `repoLabel` ride in `SelectedRecord` so the viewer
// renders without re-fetching.
//
// Decisions are indexed first so a slug colliding across kinds (rare — the
// two live in different directories) resolves to the decision. A slug absent
// from the index is a not-yet-loaded / not-yet-existing ref, NOT an error —
// callers render it plain and non-clickable.

import type { ApproachesResponse, ApproachWire, DecisionsResponse, DecisionWire } from "@/lib/api";
import type { SelectedRecord } from "./RRecordViewer";

function flattenDecisions(decisions: DecisionsResponse | null): {
  repoPath: string;
  repoLabel: string;
  record: DecisionWire;
}[] {
  if (decisions === null) return [];
  return decisions.repos.flatMap((repo) =>
    [...repo.foundations, ...repo.in_play, ...repo.warm, ...repo.cold, ...repo.superseded].map(
      (record) => ({ repoPath: repo.repo_root, repoLabel: repo.repo_label, record }),
    ),
  );
}

function flattenApproaches(approaches: ApproachesResponse | null): {
  repoPath: string;
  repoLabel: string;
  record: ApproachWire;
}[] {
  if (approaches === null) return [];
  return approaches.repos.flatMap((repo) =>
    repo.approaches.map((record) => ({
      repoPath: repo.repo_root,
      repoLabel: repo.repo_label,
      record,
    })),
  );
}

export function buildRecordIndex(
  decisions: DecisionsResponse | null,
  approaches: ApproachesResponse | null,
): Map<string, SelectedRecord> {
  const index = new Map<string, SelectedRecord>();
  for (const { repoPath, repoLabel, record } of flattenDecisions(decisions)) {
    if (!index.has(record.slug)) {
      index.set(record.slug, { kind: "decision", repoPath, repoLabel, record });
    }
  }
  for (const { repoPath, repoLabel, record } of flattenApproaches(approaches)) {
    if (!index.has(record.slug)) {
      index.set(record.slug, { kind: "approach", repoPath, repoLabel, record });
    }
  }
  return index;
}
