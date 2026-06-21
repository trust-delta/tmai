// R₂ focus state — exactly ONE focused artifact at a time.
//
// The R₂ column (`doc/approaches/2026-05-29-artifact-content-viewer.md`)
// hosts a single focused artifact: a PR or an issue. Focusing one kind clears
// the other, so the PR viewer (`RPrViewer`) and the issue viewer
// (`RIssueViewer`) are never both mounted. The invariant lives here — in one
// small testable hook — rather than spread across App's render, so
// "exactly-one-focus" is provable in isolation.
//
// The decision/approach record viewer + the calibration + hand-over viewers
// retired with the decision/approach régime (rip ① — #554); only the PR + issue
// artifacts remain on the panel.

import { useCallback, useState } from "react";
import type { SelectedIssue } from "@/components/producer-console/r-panel/r-viewer/RIssueViewer";
import type { SelectedPr } from "@/components/producer-console/r-panel/r-viewer/RPrViewer";

export interface FocusedArtifact {
  selectedPr: SelectedPr | null;
  selectedIssue: SelectedIssue | null;
  /** Focus a PR in R₂; clears any focused issue. */
  selectPr: (sel: SelectedPr) => void;
  /** Focus an issue in R₂; clears any focused PR. */
  selectIssue: (sel: SelectedIssue) => void;
  clearPr: () => void;
  clearIssue: () => void;
  /** Clear both — used on a unit change, where the previous unit's
   *  artifact must not linger under a new unit's inventory. */
  clearAll: () => void;
}

export function useFocusedArtifact(): FocusedArtifact {
  const [selectedPr, setSelectedPr] = useState<SelectedPr | null>(null);
  const [selectedIssue, setSelectedIssue] = useState<SelectedIssue | null>(null);

  const selectPr = useCallback((sel: SelectedPr) => {
    setSelectedIssue(null);
    setSelectedPr(sel);
  }, []);
  const selectIssue = useCallback((sel: SelectedIssue) => {
    setSelectedPr(null);
    setSelectedIssue(sel);
  }, []);
  const clearPr = useCallback(() => setSelectedPr(null), []);
  const clearIssue = useCallback(() => setSelectedIssue(null), []);
  const clearAll = useCallback(() => {
    setSelectedPr(null);
    setSelectedIssue(null);
  }, []);

  return {
    selectedPr,
    selectedIssue,
    selectPr,
    selectIssue,
    clearPr,
    clearIssue,
    clearAll,
  };
}
