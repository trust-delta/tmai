// R₂ focus state — exactly ONE focused artifact at a time.
//
// The R₂ column (`doc/approaches/2026-05-29-artifact-content-viewer.md`)
// hosts a single focused artifact: a PR, a record (decision/approach), an
// issue, or the unit's calibration. Focusing one kind clears the other
// three, so the PR viewer (`RPrViewer`), the record viewer
// (`RRecordViewer`), the issue viewer (`RIssueViewer`), and the
// calibration viewer (`RCalibrationViewer`) are never both/all mounted. The
// invariant lives here — in one small testable hook — rather than spread
// across App's render, so "exactly-one-focus" is provable in isolation.

import { useCallback, useState } from "react";
import type { SelectedCalibration } from "@/components/producer-console/r-panel/r-viewer/RCalibrationViewer";
import type { SelectedIssue } from "@/components/producer-console/r-panel/r-viewer/RIssueViewer";
import type { SelectedPr } from "@/components/producer-console/r-panel/r-viewer/RPrViewer";
import type { SelectedRecord } from "@/components/producer-console/r-panel/r-viewer/RRecordViewer";

export interface FocusedArtifact {
  selectedPr: SelectedPr | null;
  selectedRecord: SelectedRecord | null;
  selectedIssue: SelectedIssue | null;
  selectedCalibration: SelectedCalibration | null;
  /** Focus a PR in R₂; clears any focused record + issue + calibration. */
  selectPr: (sel: SelectedPr) => void;
  /** Focus a decision/approach in R₂; clears any focused PR + issue + calibration. */
  selectRecord: (sel: SelectedRecord) => void;
  /** Focus an issue in R₂; clears any focused PR + record + calibration. */
  selectIssue: (sel: SelectedIssue) => void;
  /** Focus the unit's calibration in R₂; clears any focused PR + record + issue. */
  selectCalibration: (sel: SelectedCalibration) => void;
  clearPr: () => void;
  clearRecord: () => void;
  clearIssue: () => void;
  clearCalibration: () => void;
  /** Clear all four — used on a unit change, where the previous unit's
   *  artifact must not linger under a new unit's inventory. */
  clearAll: () => void;
}

export function useFocusedArtifact(): FocusedArtifact {
  const [selectedPr, setSelectedPr] = useState<SelectedPr | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<SelectedRecord | null>(null);
  const [selectedIssue, setSelectedIssue] = useState<SelectedIssue | null>(null);
  const [selectedCalibration, setSelectedCalibration] = useState<SelectedCalibration | null>(null);

  const selectPr = useCallback((sel: SelectedPr) => {
    setSelectedRecord(null);
    setSelectedIssue(null);
    setSelectedCalibration(null);
    setSelectedPr(sel);
  }, []);
  const selectRecord = useCallback((sel: SelectedRecord) => {
    setSelectedPr(null);
    setSelectedIssue(null);
    setSelectedCalibration(null);
    setSelectedRecord(sel);
  }, []);
  const selectIssue = useCallback((sel: SelectedIssue) => {
    setSelectedPr(null);
    setSelectedRecord(null);
    setSelectedCalibration(null);
    setSelectedIssue(sel);
  }, []);
  const selectCalibration = useCallback((sel: SelectedCalibration) => {
    setSelectedPr(null);
    setSelectedRecord(null);
    setSelectedIssue(null);
    setSelectedCalibration(sel);
  }, []);
  const clearPr = useCallback(() => setSelectedPr(null), []);
  const clearRecord = useCallback(() => setSelectedRecord(null), []);
  const clearIssue = useCallback(() => setSelectedIssue(null), []);
  const clearCalibration = useCallback(() => setSelectedCalibration(null), []);
  const clearAll = useCallback(() => {
    setSelectedPr(null);
    setSelectedRecord(null);
    setSelectedIssue(null);
    setSelectedCalibration(null);
  }, []);

  return {
    selectedPr,
    selectedRecord,
    selectedIssue,
    selectedCalibration,
    selectPr,
    selectRecord,
    selectIssue,
    selectCalibration,
    clearPr,
    clearRecord,
    clearIssue,
    clearCalibration,
    clearAll,
  };
}
