// R₂ focus state — exactly ONE focused artifact at a time.
//
// The R₂ column (`doc/approaches/2026-05-29-artifact-content-viewer.md`)
// hosts a single focused artifact: a PR, a record (decision/approach), or an
// issue. Focusing one kind clears the other two, so the PR viewer
// (`RPrViewer`), the record viewer (`RRecordViewer`), and the issue viewer
// (`RIssueViewer`) are never more than one mounted. The invariant lives
// here — in one small testable hook — rather than spread across App's
// render, so "exactly-one-focus" is provable in isolation.
//
// The calibration + hand-over viewers retired with their R-panel sections
// (attention model §3-2b, #772 — agent-operation surfaces, off the Artifact
// panel); their api-client methods + wire types stay dormant/reusable.

import { useCallback, useState } from "react";
import type { SelectedIssue } from "@/components/producer-console/r-panel/r-viewer/RIssueViewer";
import type { SelectedPr } from "@/components/producer-console/r-panel/r-viewer/RPrViewer";
import type { SelectedRecord } from "@/components/producer-console/r-panel/r-viewer/RRecordViewer";

export interface FocusedArtifact {
  selectedPr: SelectedPr | null;
  selectedRecord: SelectedRecord | null;
  selectedIssue: SelectedIssue | null;
  /** Focus a PR in R₂; clears any focused record + issue. */
  selectPr: (sel: SelectedPr) => void;
  /** Focus a decision/approach in R₂; clears any focused PR + issue. */
  selectRecord: (sel: SelectedRecord) => void;
  /** Focus an issue in R₂; clears any focused PR + record. */
  selectIssue: (sel: SelectedIssue) => void;
  clearPr: () => void;
  clearRecord: () => void;
  clearIssue: () => void;
  /** Clear all three — used on a unit change, where the previous unit's
   *  artifact must not linger under a new unit's inventory. */
  clearAll: () => void;
}

export function useFocusedArtifact(): FocusedArtifact {
  const [selectedPr, setSelectedPr] = useState<SelectedPr | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<SelectedRecord | null>(null);
  const [selectedIssue, setSelectedIssue] = useState<SelectedIssue | null>(null);

  const selectPr = useCallback((sel: SelectedPr) => {
    setSelectedRecord(null);
    setSelectedIssue(null);
    setSelectedPr(sel);
  }, []);
  const selectRecord = useCallback((sel: SelectedRecord) => {
    setSelectedPr(null);
    setSelectedIssue(null);
    setSelectedRecord(sel);
  }, []);
  const selectIssue = useCallback((sel: SelectedIssue) => {
    setSelectedPr(null);
    setSelectedRecord(null);
    setSelectedIssue(sel);
  }, []);
  const clearPr = useCallback(() => setSelectedPr(null), []);
  const clearRecord = useCallback(() => setSelectedRecord(null), []);
  const clearIssue = useCallback(() => setSelectedIssue(null), []);
  const clearAll = useCallback(() => {
    setSelectedPr(null);
    setSelectedRecord(null);
    setSelectedIssue(null);
  }, []);

  return {
    selectedPr,
    selectedRecord,
    selectedIssue,
    selectPr,
    selectRecord,
    selectIssue,
    clearPr,
    clearRecord,
    clearIssue,
    clearAll,
  };
}
