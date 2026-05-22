// Persistent right-hand attention strip — P1 of the L/C/R co-visible
// re-layout (`doc/decisions/2026-05-14-react-producer-console-rebuild.md`
// §Refinement 2026-05-22), refined by §"P1.1 — lived-feedback adjustment".
//
// WHY this exists: before P1, selecting an agent (the Producer
// conversation = PreviewPanel) *replaced* the ProducerConsole digest in
// the single `<main>`, and `returnToConsole` was the only way back. So
// the operator could not read the attention surface and converse at the
// same time — the digest↔conversation screen-switch the refinement set
// out to kill. This strip is mounted in `App.tsx` as a sibling of
// `<main>` (a third flex column), OUTSIDE the `selection` switch, so it
// stays co-visible with whatever the centre shows — digest, Producer
// conversation, or the git/docs multipane (P2 retires the latter; P1
// leaves it in place).
//
// Fork A — DUMB SUBSET: the strip is attention-grade status only. P1.1
// sharpened the rule to "changes-during-session ⇒ strip; read-once-at-
// start ⇒ briefing", so the slow-moving ▣ verdict-awaiting approaches
// moved OUT of the strip and back to the centre digest (start-briefing).
// The strip now reuses three self-contained sections in width-constrained
// form:
//   ▶ Blocked / awaiting agents   (WhereYouLeftOffSection, attentionOnly —
//                                  the strip relabels the ▶ header; the
//                                  centre digest keeps "Where you left off")
//   🔀 open PRs + CI               (UnitPrsSection)
//   ⬢ cross-unit needs-you         (CrossUnitStatusSection)
// The heavy context (full ⬡ Settled decisions list, ◐ Working-with-this-
// human / MEMORY) and the ▣ approaches deliberately stay in the on-demand
// centre digest, not here. Per the pre-producer-dashboard convergence
// (`doc/decisions/2026-05-20-provisional-pre-producer-dashboard.md`) this
// is a dumb status surface: no priority scalar, no anomaly sort, no
// re-ranking — the section order below is a fixed reading order, not a
// judgment. The always-on TripwireBanner lives in `App.tsx` above the
// centre and is not duplicated here.
//
// WIDTH: the expanded strip is drag-resizable (P1.1). The drag itself is
// driven by the shared `useSplitPane` engine wired in `App.tsx` (which
// owns the persisted `attentionStripWidth` pref); this component just
// renders the left-edge handle and applies the width. While dragging we
// size from the live ratio (a % of the app row) so the edge tracks the
// cursor; when idle we apply the persisted px width directly. minWidth /
// maxWidth pin both to the legal window so an extreme drag stops cleanly.

import { useHandover } from "@/hooks/useHandover";
import { makeSplitKeyHandler, RATIO_STEP } from "@/hooks/useSplitPane";
import { ATTENTION_STRIP_WIDTH_MAX, ATTENTION_STRIP_WIDTH_MIN } from "@/lib/ui-prefs";
import { CrossUnitStatusSection } from "./sections/CrossUnitStatusSection";
import { UnitPrsSection } from "./sections/UnitPrsSection";
import { WhereYouLeftOffSection } from "./sections/WhereYouLeftOffSection";

/** Drag-resize wiring for the expanded strip. App.tsx builds this from the
 *  shared `useSplitPane` hook + the `attentionStripWidth` pref, so the strip
 *  stays a pure presentation surface (mirrors how SplitPaneLayout receives
 *  its divider props from App). */
export interface AttentionStripResize {
  /** Persisted px width — applied directly when not mid-drag. */
  width: number;
  /** True while the divider is being dragged (live % sizing + active styling). */
  isResizing: boolean;
  /** Live split ratio (0–1) of the app row; the strip occupies `1 − ratio`. */
  ratio: number;
  onMouseDown: (e: React.MouseEvent) => void;
  /** Reset to the default width (double-click affordance). */
  onDoubleClick: () => void;
  /** Keyboard ratio nudge (arrow keys / Home / End) — wired to adjustRatio. */
  onAdjust: (delta: number) => void;
}

interface AttentionStripProps {
  /** Currently focused project (App.tsx's `currentProject`). Scopes the
   *  ▶ attention list and the unit for the PR section. */
  currentProjectPath: string | null;
  /** Unit name — basename of `currentProjectPath`. Drives the wire-backed
   *  PR section (`resolve_unit_or_cwd` falls back to the basename when no
   *  `[[unit]]` table matches). */
  unitName: string | null;
  /** Wired to App.tsx's `handleSelectProject` so picking a unit in the
   *  strip matches sidebar / centre-digest selection exactly. */
  onSelectProjectByPath: (path: string, name: string) => void;
  /** Collapsed = folded to a thin rail (operator reclaims width when the
   *  centre is busy). Persisted by App.tsx via the `attentionStripCollapsed`
   *  UI pref. */
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Drag-resize wiring (only consumed when expanded). */
  resize: AttentionStripResize;
}

export function AttentionStrip({
  currentProjectPath,
  unitName,
  onSelectProjectByPath,
  collapsed,
  onToggleCollapsed,
  resize,
}: AttentionStripProps) {
  const { whereYouLeftOff, crossUnit, missingPreconditions } = useHandover(currentProjectPath);

  if (collapsed) {
    return (
      <aside
        data-testid="attention-strip"
        data-collapsed="true"
        className="glass flex w-9 shrink-0 flex-col items-center border-l border-hairline py-2"
      >
        <button
          type="button"
          onClick={onToggleCollapsed}
          title="Expand attention strip"
          aria-label="Expand attention strip"
          aria-expanded={false}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-strong hover:text-foreground"
        >
          ‹
        </button>
        {/* Vertical label so the rail still reads as the attention surface
            even when folded. `writing-mode` keeps it on one rotated line. */}
        <span
          className="mt-2 select-none text-[10px] uppercase tracking-widest text-subtle-foreground"
          style={{ writingMode: "vertical-rl" }}
        >
          Attention
        </span>
      </aside>
    );
  }

  // While dragging, size from the live ratio so the left edge tracks the
  // cursor (a % of the app row, since the ratio is row-relative); when idle,
  // apply the persisted px width directly. min/max pin both forms to the
  // legal window so the strip can't be dragged to starve the centre.
  const width = resize.isResizing ? `${(1 - resize.ratio) * 100}%` : `${resize.width}px`;
  const onHandleKeyDown = makeSplitKeyHandler("horizontal", RATIO_STEP, resize.onAdjust);

  return (
    <aside
      data-testid="attention-strip"
      data-collapsed="false"
      className="glass relative flex shrink-0 flex-col border-l border-hairline"
      style={{
        width,
        minWidth: ATTENTION_STRIP_WIDTH_MIN,
        maxWidth: ATTENTION_STRIP_WIDTH_MAX,
      }}
    >
      {/* Left-edge resize handle (same WAI-ARIA Window Splitter pattern as
          SplitPaneLayout). Absolutely positioned over the left border and
          nudged half its width outward so the hit target straddles the edge.
          biome-ignore lint/a11y/useSemanticElements: a div is the draggable splitter */}
      <div
        role="separator"
        tabIndex={0}
        aria-orientation="vertical"
        aria-label="Resize attention strip"
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
            resize.isResizing ? "bg-primary/50" : "bg-surface group-hover:bg-primary/30"
          }`}
        />
        <div className="absolute flex flex-col gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <div className="h-1 w-1 rounded-full bg-muted-foreground" />
          <div className="h-1 w-1 rounded-full bg-muted-foreground" />
          <div className="h-1 w-1 rounded-full bg-muted-foreground" />
        </div>
      </div>

      <header className="flex shrink-0 items-center justify-between border-b border-hairline px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">Attention</h2>
        <button
          type="button"
          onClick={onToggleCollapsed}
          title="Collapse attention strip"
          aria-label="Collapse attention strip"
          aria-expanded={true}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-strong hover:text-foreground"
        >
          ›
        </button>
      </header>

      <div className="flex-1 space-y-6 overflow-y-auto px-4 py-4 text-sm">
        <WhereYouLeftOffSection data={whereYouLeftOff} attentionOnly />
        <UnitPrsSection unitName={unitName} />
        <CrossUnitStatusSection
          data={crossUnit}
          activePath={currentProjectPath}
          onSelectUnit={onSelectProjectByPath}
          preconditions={missingPreconditions}
        />
      </div>
    </aside>
  );
}
