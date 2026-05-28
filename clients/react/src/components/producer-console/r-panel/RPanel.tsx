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
        />
        <RIssuesSection
          currentProjectPath={currentProjectPath}
          expanded={isExpanded("issues")}
          onToggle={() => toggle("issues")}
        />
        <RDecisionsSection
          unitName={unitName}
          expanded={isExpanded("decisions")}
          onToggle={() => toggle("decisions")}
        />
        <RApproachesSection
          unitName={unitName}
          expanded={isExpanded("approaches")}
          onToggle={() => toggle("approaches")}
        />
        <RCalibrationSection
          unitName={unitName}
          expanded={isExpanded("calibration")}
          onToggle={() => toggle("calibration")}
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
    </aside>
  );
}
