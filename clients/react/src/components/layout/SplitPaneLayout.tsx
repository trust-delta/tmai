import type { ReactNode, RefObject } from "react";
import { makeSplitKeyHandler, RATIO_STEP } from "@/hooks/useSplitPane";

type RightTab = "git" | "markdown";
type Orientation = "horizontal" | "vertical";

interface SplitPaneLayoutProps {
  /** First pane (horizontal: left, vertical: top). */
  left: ReactNode;
  /** Second pane (horizontal: right, vertical: bottom). Driven by `rightTab`. */
  right: ReactNode;
  rightTab: RightTab;
  onTabChange: (tab: RightTab) => void;
  /** Split ratio 0.0–1.0 — fraction assigned to the first pane. */
  splitRatio: number;
  isDragging: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  onDividerMouseDown: (e: React.MouseEvent) => void;
  onDividerDoubleClick: () => void;
  /** Keyboard ratio nudges (arrow keys + Home/End). When omitted, the divider
   *  is focusable but inert for keyboard-only users — wire this to the matching
   *  `useSplitPane().adjustRatio` to comply with WAI-ARIA Window Splitter. */
  onAdjustRatio?: (delta: number) => void;
  orientation?: Orientation;
}

function ratioToPercent(ratio: number): number {
  return Math.round(ratio * 100);
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? "bg-white/10 text-cyan-400"
          : "text-zinc-500 hover:bg-white/[0.05] hover:text-zinc-300"
      }`}
    >
      {children}
    </button>
  );
}

// Two-pane split with a draggable divider and a tab bar on the second pane.
// `orientation` flips between left/right (default) and top/bottom.
export function SplitPaneLayout({
  left,
  right,
  rightTab,
  onTabChange,
  splitRatio,
  isDragging,
  containerRef,
  onDividerMouseDown,
  onDividerDoubleClick,
  onAdjustRatio,
  orientation = "horizontal",
}: SplitPaneLayoutProps) {
  const onKeyDown = onAdjustRatio
    ? makeSplitKeyHandler(orientation, RATIO_STEP, onAdjustRatio)
    : undefined;
  const isHorizontal = orientation === "horizontal";
  const firstPercent = `${(splitRatio * 100).toFixed(2)}%`;
  const secondPercent = `${((1 - splitRatio) * 100).toFixed(2)}%`;

  const containerClass = isHorizontal
    ? "flex h-full flex-1 overflow-hidden"
    : "flex h-full flex-1 flex-col overflow-hidden";
  const dividerClass = isHorizontal
    ? "group relative flex shrink-0 cursor-col-resize items-center justify-center"
    : "group relative flex shrink-0 cursor-row-resize items-center justify-center";
  const dividerStyle = isHorizontal ? { width: "5px" } : { height: "5px" };
  const dividerLineClass = isHorizontal
    ? `h-full w-px transition-colors ${
        isDragging ? "bg-cyan-500/50" : "bg-white/[0.06] group-hover:bg-cyan-500/30"
      }`
    : `h-px w-full transition-colors ${
        isDragging ? "bg-cyan-500/50" : "bg-white/[0.06] group-hover:bg-cyan-500/30"
      }`;
  const handleClass = isHorizontal
    ? "absolute flex flex-col gap-1 opacity-0 transition-opacity group-hover:opacity-100"
    : "absolute flex flex-row gap-1 opacity-0 transition-opacity group-hover:opacity-100";

  const firstPaneStyle = isHorizontal ? { width: firstPercent } : { height: firstPercent };
  const secondPaneStyle = isHorizontal ? { width: secondPercent } : { height: secondPercent };

  return (
    <div ref={containerRef} className={`${containerClass} ${isDragging ? "select-none" : ""}`}>
      <div className="flex flex-col overflow-hidden" style={firstPaneStyle}>
        {left}
      </div>

      {/* biome-ignore lint/a11y/useSemanticElements: <hr> cannot serve as a draggable split handle */}
      <div
        role="separator"
        tabIndex={0}
        aria-valuenow={ratioToPercent(splitRatio)}
        aria-valuemin={20}
        aria-valuemax={80}
        aria-label="Resize split pane"
        aria-orientation={isHorizontal ? "vertical" : "horizontal"}
        className={dividerClass}
        style={dividerStyle}
        onMouseDown={onDividerMouseDown}
        onDoubleClick={onDividerDoubleClick}
        onKeyDown={onKeyDown}
      >
        <div className={dividerLineClass} />
        <div className={handleClass}>
          <div className="h-1 w-1 rounded-full bg-zinc-500" />
          <div className="h-1 w-1 rounded-full bg-zinc-500" />
          <div className="h-1 w-1 rounded-full bg-zinc-500" />
        </div>
      </div>

      <div className="flex flex-col overflow-hidden" style={secondPaneStyle}>
        <div className="flex shrink-0 items-center gap-1 border-b border-white/[0.06] px-3 py-1.5">
          <TabButton active={rightTab === "git"} onClick={() => onTabChange("git")}>
            Git
          </TabButton>
          <TabButton active={rightTab === "markdown"} onClick={() => onTabChange("markdown")}>
            Docs
          </TabButton>
        </div>

        <div className="flex flex-1 flex-col overflow-hidden">{right}</div>
      </div>
    </div>
  );
}
