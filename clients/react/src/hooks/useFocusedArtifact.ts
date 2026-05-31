// R₂ focus state — exactly ONE focused artifact at a time.
//
// The R₂ column (`doc/approaches/2026-05-29-artifact-content-viewer.md`)
// hosts a single focused artifact: a PR, a decision, or an approach.
// Focusing one kind clears the other, so the PR viewer (`RPrViewer`) and
// the record viewer (`RRecordViewer`) are never both mounted. The
// invariant lives here — in one small testable hook — rather than spread
// across App's render, so "exactly-one-focus" is provable in isolation.

import { useCallback, useState } from "react";
import type { SelectedPr } from "@/components/producer-console/r-panel/r-viewer/RPrViewer";
import type { SelectedRecord } from "@/components/producer-console/r-panel/r-viewer/RRecordViewer";

export interface FocusedArtifact {
  selectedPr: SelectedPr | null;
  selectedRecord: SelectedRecord | null;
  /** Focus a PR in R₂; clears any focused record. */
  selectPr: (sel: SelectedPr) => void;
  /** Focus a decision/approach in R₂; clears any focused PR. */
  selectRecord: (sel: SelectedRecord) => void;
  clearPr: () => void;
  clearRecord: () => void;
  /** Clear both — used on a unit change, where the previous unit's
   *  artifact must not linger under a new unit's inventory. */
  clearAll: () => void;
}

export function useFocusedArtifact(): FocusedArtifact {
  const [selectedPr, setSelectedPr] = useState<SelectedPr | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<SelectedRecord | null>(null);

  const selectPr = useCallback((sel: SelectedPr) => {
    setSelectedRecord(null);
    setSelectedPr(sel);
  }, []);
  const selectRecord = useCallback((sel: SelectedRecord) => {
    setSelectedPr(null);
    setSelectedRecord(sel);
  }, []);
  const clearPr = useCallback(() => setSelectedPr(null), []);
  const clearRecord = useCallback(() => setSelectedRecord(null), []);
  const clearAll = useCallback(() => {
    setSelectedPr(null);
    setSelectedRecord(null);
  }, []);

  return {
    selectedPr,
    selectedRecord,
    selectPr,
    selectRecord,
    clearPr,
    clearRecord,
    clearAll,
  };
}
