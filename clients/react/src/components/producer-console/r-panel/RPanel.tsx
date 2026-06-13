// R panel — project-artifact inventory (= Artifact panel, the
// git/remote-resident project substance; approach
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
//   - all sections collapsed by default (operator-driven expand
//     persisted via `rPanelExpandedSections`).
//
// Attention model §3 (contract
// `tmai-core:doc/approaches/2026-06-04-attention-as-per-artifact-field.md`):
// attention is a per-artifact field surfaced as a per-row marker
// (§3-core, #769). §3-2b removed the three agent-operation surfaces
// that were NOT project artifacts and have no live referent here —
// the Δ-stream (Δ dissolved into each artifact's `null`-state marker),
// the Calibration section (a stranded Phase-1 detector), and the
// Hand-over section (a session-boundary baton, agent-operation
// runtime). They live on the data-dir side, off this Artifact panel
// (cut: `tmai-core:doc/observations/2026-06-03-artifact-panel-vs-producer-panel-cut.md`).
//
// The collapsed rail behaviour and drag-resize wiring mirror the
// retired strip 1:1 so App.tsx layout stays unchanged.

import { useCallback } from "react";
import { makeSplitKeyHandler, RATIO_STEP } from "@/hooks/useSplitPane";
import { useUnitAttention } from "@/hooks/useUnitAttention";
import { useUnitIssues } from "@/hooks/useUnitIssues";
import { useUnitPrs } from "@/hooks/useUnitPrs";
import { ATTENTION_STRIP_WIDTH_MAX, ATTENTION_STRIP_WIDTH_MIN } from "@/lib/ui-prefs";
import { useUIPref } from "@/lib/ui-prefs-provider";
import { RAimsSection } from "./RAimsSection";
import { RApproachesSection } from "./RApproachesSection";
import { RDecisionsSection } from "./RDecisionsSection";
import { RFilesSection } from "./RFilesSection";
import { RInventorySection } from "./RInventorySection";
import { RIssuesSection } from "./RIssuesSection";
import { RObservationsSection } from "./RObservationsSection";
import { RPrsSection } from "./RPrsSection";
import type { SelectedIssue } from "./r-viewer/RIssueViewer";
import type { SelectedPr } from "./r-viewer/RPrViewer";
import type { SelectedRecord } from "./r-viewer/RRecordViewer";
import {
  advanceCursor,
  effectiveCursor,
  unobservedIssueCount,
  unobservedPrCount,
} from "./remote-delta";

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
  "observations",
  "aims",
  "inventory",
  "files",
] as const;

export function RPanel({
  currentProjectPath,
  unitName,
  collapsed,
  onToggleCollapsed,
  resize,
  onSelectPr,
  selectedPrKey,
  onSelectRecord,
  selectedRecordKey,
  onSelectIssue,
  selectedIssueKey,
  viewer,
}: RPanelProps) {
  const [expanded, setExpanded] = useUIPref("rPanelExpandedSections");

  // One attention hook for the whole panel (not one per section): the POST
  // returns the full updated map, so a server-side demotion (a prior `high`
  // knocked to `low` to keep `high`≤1/dimension) lands on the PR + Issue
  // sections at once. Threaded down to the five attention-artifact sections
  // (pr / issue / decision / approach / observation); File is attention-exempt
  // and is NOT given the controls.
  const attention = useUnitAttention(unitName);

  // Remote-Δ freshness cursors (#822) — client state only (ui-prefs), never
  // sent to core; the Producer never reads it. Exactly TWO acts advance a
  // cursor: the panel collapse and a PRs/Issues section collapse, both
  // below. Nothing else (no visibilitychange / scroll / per-row marking /
  // timers) may call advanceCursor.
  const [cursors, setCursors] = useUIPref("remoteDeltaCursors");
  const prsCursor = unitName === null ? null : effectiveCursor(cursors, unitName, "prs");
  const issuesCursor = unitName === null ? null : effectiveCursor(cursors, unitName, "issues");

  // Collapsed-rail Δ count: the rail still shows the unit total of
  // unobserved PR + issue rows, but the section components (which normally
  // own the fetch) are unmounted while collapsed — so the panel polls in
  // their stead. Parked (null unit) while expanded so panel and sections
  // never double-poll the same unit.
  const railUnit = collapsed ? unitName : null;
  const railPrs = useUnitPrs(railUnit);
  const railIssues = useUnitIssues(railUnit);
  const railUnobserved =
    unobservedPrCount(railPrs.data?.repos ?? null, prsCursor) +
    unobservedIssueCount(railIssues.data?.repos ?? null, issuesCursor);

  const toggle = useCallback(
    (id: string) => {
      const closing = expanded.includes(id);
      // Section-collapse act: stamp that section's cursor. Only the CLOSE
      // direction advances — expanding is the start of looking, not the end.
      if (closing && unitName !== null && (id === "prs" || id === "issues")) {
        setCursors(advanceCursor(cursors, unitName, id, new Date().toISOString()));
      }
      setExpanded(closing ? expanded.filter((x) => x !== id) : [...expanded, id]);
    },
    [expanded, setExpanded, cursors, setCursors, unitName],
  );

  // Panel-collapse act: stamp the unit's `panel` cursor (the coarse "when
  // the operator last stopped looking" timestamp) then collapse. The
  // expand button on the collapsed rail uses the plain onToggleCollapsed —
  // opening is not a close act.
  const collapsePanel = useCallback(() => {
    if (unitName !== null) {
      setCursors(advanceCursor(cursors, unitName, "panel", new Date().toISOString()));
    }
    onToggleCollapsed();
  }, [cursors, setCursors, unitName, onToggleCollapsed]);

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
        {/* Remote-Δ unit total (#822): unobserved PR + issue rows since the
            close acts. Within-unit count only — info-tone freshness fact,
            never the owed amber; no cross-unit accent (deferred until a
            second unit exists). */}
        {railUnobserved > 0 && (
          <span
            data-testid="r-rail-unobserved"
            title={`${railUnobserved} unobserved remote ${railUnobserved === 1 ? "change" : "changes"} since you last looked`}
            className="mt-2 select-none font-mono text-[10px] text-info"
          >
            Δ{railUnobserved}
          </span>
        )}
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
              onClick={collapsePanel}
              title="Collapse R panel"
              aria-label="Collapse R panel"
              aria-expanded={true}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-strong hover:text-foreground"
            >
              ›
            </button>
          </header>

          <div className="flex-1 space-y-1 overflow-y-auto px-2 py-2">
            <RPrsSection
              unitName={unitName}
              expanded={isExpanded("prs")}
              onToggle={() => toggle("prs")}
              onSelectPr={onSelectPr}
              selectedKey={selectedPrKey}
              attention={attention}
              deltaCursor={prsCursor}
            />
            <RIssuesSection
              unitName={unitName}
              expanded={isExpanded("issues")}
              onToggle={() => toggle("issues")}
              onSelectIssue={onSelectIssue}
              selectedKey={selectedIssueKey}
              attention={attention}
              deltaCursor={issuesCursor}
            />
            <RDecisionsSection
              unitName={unitName}
              expanded={isExpanded("decisions")}
              onToggle={() => toggle("decisions")}
              onSelect={onSelectRecord}
              selectedKey={selectedRecordKey}
              attention={attention}
            />
            <RApproachesSection
              unitName={unitName}
              expanded={isExpanded("approaches")}
              onToggle={() => toggle("approaches")}
              onSelect={onSelectRecord}
              selectedKey={selectedRecordKey}
              attention={attention}
            />
            <RObservationsSection
              unitName={unitName}
              expanded={isExpanded("observations")}
              onToggle={() => toggle("observations")}
              attention={attention}
            />
            {/* Aims — the aim-tree read view (#780). Not an attention-artifact
                section (the 5 are pr / issue / decision / approach /
                observation), so it is NOT given the attention controls. */}
            <RAimsSection
              unitName={unitName}
              expanded={isExpanded("aims")}
              onToggle={() => toggle("aims")}
            />
            <RInventorySection
              unitName={unitName}
              expanded={isExpanded("inventory")}
              onToggle={() => toggle("inventory")}
              onSelect={onSelectRecord}
              selectedKey={selectedRecordKey}
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
