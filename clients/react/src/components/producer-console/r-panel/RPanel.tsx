// R panel — project artifact inventory (approach
// `doc/approaches/2026-05-29-r-panel-as-project-artifact-inventory.md`).
//
// Replaces the retired Fork-A "attention-grade only" strip. That
// strip's `filter "needs you"` selection was itself an act of
// appraisal; R inverts the discriminator — show ALL artifacts of
// every category, let the operator scan. Per the approach's
// "tmai は何を絶対しない" rules:
//
//   - no severity color: only `text-foreground` /
//     `text-muted-foreground` / `text-subtle-foreground` here;
//   - no priority sort, no filter "needs you", no aggregate status
//     pill, no count-badge urgency styling;
//   - all 7 sections collapsed by default (operator-driven expand
//     persisted via `rPanelExpandedSections`).
//
// Δ stream at the top is the one moving surface, fed by the
// existing producer-feed cursor (the same the Producer pull reads).
// `[→Producer ⚡]` was the C-column "Check deltas ▸" button, moved
// here so the operator's "deltas exist" awareness and the trigger
// live next to one another.
//
// The collapsed rail behaviour and drag-resize wiring mirror the
// retired strip 1:1 so App.tsx layout stays unchanged.

import { useCallback } from "react";
import { makeSplitKeyHandler, RATIO_STEP } from "@/hooks/useSplitPane";
import type { ProducerFeedStatus } from "@/lib/api";
import { ATTENTION_STRIP_WIDTH_MAX, ATTENTION_STRIP_WIDTH_MIN } from "@/lib/ui-prefs";
import { useUIPref } from "@/lib/ui-prefs-provider";
import { DeltaStream } from "./DeltaStream";
import { RApproachesSection } from "./RApproachesSection";
import { RCalibrationSection } from "./RCalibrationSection";
import { RDecisionsSection } from "./RDecisionsSection";
import { RFilesSection } from "./RFilesSection";
import { RHandoverSection } from "./RHandoverSection";
import { RIssuesSection } from "./RIssuesSection";
import { RPrsSection } from "./RPrsSection";
import type { SelectedCalibration } from "./r-viewer/RCalibrationViewer";
import type { SelectedIssue } from "./r-viewer/RIssueViewer";
import type { SelectedPr } from "./r-viewer/RPrViewer";
import type { SelectedRecord } from "./r-viewer/RRecordViewer";

export interface RPanelResize {
  width: number;
  isResizing: boolean;
  ratio: number;
  onMouseDown: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onAdjust: (delta: number) => void;
}

interface RPanelProps {
  currentProjectPath: string | null;
  unitName: string | null;
  producerFeedData: ProducerFeedStatus | null;
  onTriggerDeltaPull: () => void;
  /** Whether a live Producer exists for the unit (`findProducerForUnit`
   *  result from App.tsx). Gates the Δ stream's trigger button. */
  producerAvailable: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  resize: RPanelResize;
  /** Open a PR in the independent R₂ viewer column (#749). Threaded to
   *  the R₁ PR inventory so a row click selects the PR for in-tmai
   *  viewing instead of linking out to github.com. */
  onSelectPr?: (sel: SelectedPr) => void;
  /** `selectedPrKey(...)` of the PR currently open in R₂, so the R₁ row
   *  marks itself as the one being viewed. */
  selectedPrKey?: string | null;
  /** Open a decision/approach in the R₂ record viewer column. Threaded to
   *  the R₁ Decisions + Approaches inventories so a row click selects the
   *  record for in-tmai viewing. */
  onSelectRecord?: (sel: SelectedRecord) => void;
  /** `selectedRecordKey(...)` of the record currently open in R₂, so the
   *  focused R₁ Decisions/Approaches row marks itself. */
  selectedRecordKey?: string | null;
  /** Open an issue in the R₂ issue viewer column. Threaded to the R₁
   *  Issues inventory so a row click selects the issue for in-tmai
   *  viewing. */
  onSelectIssue?: (sel: SelectedIssue) => void;
  /** `selectedIssueKey(...)` of the issue currently open in R₂, so the
   *  focused R₁ Issues row marks itself. */
  selectedIssueKey?: string | null;
  /** Open the unit's calibration in the R₂ calibration viewer column.
   *  Threaded to the R₁ Calibration section so its detail affordance
   *  focuses the calibration for in-tmai viewing. */
  onSelectCalibration?: (sel: SelectedCalibration) => void;
  /** `selectedCalibrationKey(unit)` of the calibration currently open in
   *  R₂, so the focused R₁ Calibration affordance marks itself. */
  selectedCalibrationKey?: string | null;
  /** Focus mode (spine `2026-05-29-c-and-r-as-the-development-substrate`,
   *  its deferred "R₁/R₂ visual ratio" point): the R₂ viewer for the
   *  currently-focused artifact. When non-null it RIDES THIS SAME COLUMN —
   *  rendered in place of the R₁ inventory body, at the same drag-set
   *  width, with the same collapse/drag machinery — so opening a viewer
   *  NEVER adds a width-stealing fourth column (the load-bearing
   *  C-width invariant). When null, the inventory shows as today. The
   *  parent (App) composes the node and keeps PR/record/issue mutually
   *  exclusive via `useFocusedArtifact`. */
  viewer?: React.ReactNode;
}

const SECTION_IDS = [
  "prs",
  "issues",
  "decisions",
  "approaches",
  "calibration",
  "handover",
  "files",
] as const;

export function RPanel({
  currentProjectPath,
  unitName,
  producerFeedData,
  onTriggerDeltaPull,
  producerAvailable,
  collapsed,
  onToggleCollapsed,
  resize,
  onSelectPr,
  selectedPrKey,
  onSelectRecord,
  selectedRecordKey,
  onSelectIssue,
  selectedIssueKey,
  onSelectCalibration,
  selectedCalibrationKey,
  viewer,
}: RPanelProps) {
  const [expanded, setExpanded] = useUIPref("rPanelExpandedSections");

  const toggle = useCallback(
    (id: string) => {
      setExpanded(expanded.includes(id) ? expanded.filter((x) => x !== id) : [...expanded, id]);
    },
    [expanded, setExpanded],
  );

  if (collapsed) {
    return (
      <aside
        data-testid="r-panel"
        data-collapsed="true"
        className="glass flex w-9 shrink-0 flex-col items-center border-l border-hairline py-2"
      >
        <button
          type="button"
          onClick={onToggleCollapsed}
          title="Expand R panel"
          aria-label="Expand R panel"
          aria-expanded={false}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-strong hover:text-foreground"
        >
          ‹
        </button>
        <span
          className="mt-2 select-none text-[10px] uppercase tracking-widest text-subtle-foreground"
          style={{ writingMode: "vertical-rl" }}
        >
          R · Inventory
        </span>
      </aside>
    );
  }

  const width = resize.isResizing ? `${(1 - resize.ratio) * 100}%` : `${resize.width}px`;
  const onHandleKeyDown = makeSplitKeyHandler("horizontal", RATIO_STEP, resize.onAdjust);
  const isExpanded = (id: (typeof SECTION_IDS)[number]) => expanded.includes(id);

  return (
    <aside
      data-testid="r-panel"
      data-collapsed="false"
      className="glass relative flex shrink-0 flex-col border-l border-hairline"
      style={{
        width,
        minWidth: ATTENTION_STRIP_WIDTH_MIN,
        maxWidth: ATTENTION_STRIP_WIDTH_MAX,
      }}
    >
      {/* biome-ignore lint/a11y/useSemanticElements: a div is the draggable splitter */}
      <div
        role="separator"
        tabIndex={0}
        aria-orientation="vertical"
        aria-label="Resize R panel"
        aria-valuenow={Math.round((1 - resize.ratio) * 100)}
        aria-valuemin={20}
        aria-valuemax={80}
        className="group absolute inset-y-0 left-0 z-10 flex w-1.5 -translate-x-1/2 cursor-col-resize items-center justify-center"
        onMouseDown={resize.onMouseDown}
        onDoubleClick={resize.onDoubleClick}
        onKeyDown={onHandleKeyDown}
      >
        <div
          className={`h-full w-px transition-colors ${
            resize.isResizing ? "bg-foreground/30" : "bg-surface group-hover:bg-foreground/20"
          }`}
        />
      </div>

      {/* Focus mode: when a viewer is handed in, it REPLACES the inventory
          body in this same column (same width, same drag splitter above),
          so opening a viewer never adds a fourth column that would steal
          width from the centre conversation. The viewer fills the column
          (`flex-1`) and brings its own header + ‹ Inventory back
          affordance. Otherwise the R₁ inventory renders exactly as before. */}
      {viewer ?? (
        <>
          <header className="flex shrink-0 items-center justify-between border-b border-hairline px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">R · Inventory</h2>
            <button
              type="button"
              onClick={onToggleCollapsed}
              title="Collapse R panel"
              aria-label="Collapse R panel"
              aria-expanded={true}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-strong hover:text-foreground"
            >
              ›
            </button>
          </header>

          <DeltaStream
            unitName={unitName}
            data={producerFeedData}
            onTriggerDeltaPull={onTriggerDeltaPull}
            producerAvailable={producerAvailable}
          />

          <div className="flex-1 space-y-1 overflow-y-auto px-2 py-2">
            <RPrsSection
              unitName={unitName}
              expanded={isExpanded("prs")}
              onToggle={() => toggle("prs")}
              onSelectPr={onSelectPr}
              selectedKey={selectedPrKey}
            />
            <RIssuesSection
              currentProjectPath={currentProjectPath}
              expanded={isExpanded("issues")}
              onToggle={() => toggle("issues")}
              onSelectIssue={onSelectIssue}
              selectedKey={selectedIssueKey}
            />
            <RDecisionsSection
              unitName={unitName}
              expanded={isExpanded("decisions")}
              onToggle={() => toggle("decisions")}
              onSelect={onSelectRecord}
              selectedKey={selectedRecordKey}
            />
            <RApproachesSection
              unitName={unitName}
              expanded={isExpanded("approaches")}
              onToggle={() => toggle("approaches")}
              onSelect={onSelectRecord}
              selectedKey={selectedRecordKey}
            />
            <RCalibrationSection
              unitName={unitName}
              expanded={isExpanded("calibration")}
              onToggle={() => toggle("calibration")}
              onSelectCalibration={onSelectCalibration}
              selectedKey={selectedCalibrationKey}
            />
            <RHandoverSection
              unitName={unitName}
              expanded={isExpanded("handover")}
              onToggle={() => toggle("handover")}
            />
            <RFilesSection
              currentProjectPath={currentProjectPath}
              unitName={unitName}
              expanded={isExpanded("files")}
              onToggle={() => toggle("files")}
            />
          </div>
        </>
      )}
    </aside>
  );
}
