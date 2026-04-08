import type { ReactNode, RefObject } from "react";

type RightTab = "git" | "markdown" | "flow";

interface SplitPaneLayoutProps {
  left: ReactNode;
  right: ReactNode;
  rightTab: RightTab;
  onTabChange: (tab: RightTab) => void;
  /** Split ratio 0.0–1.0 (fraction assigned to left pane) */
  splitRatio: number;
  isDragging: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  onDividerMouseDown: (e: React.MouseEvent) => void;
  onDividerDoubleClick: () => void;
}

// Convert split ratio (0–1) to ARIA percentage (0–100)
function ratioToPercent(ratio: number): number {
  return Math.round(ratio * 100);
}

// Tab button for the right panel header
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

// Split-pane layout: left panel + draggable divider + right panel with tab bar
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
}: SplitPaneLayoutProps) {
  const leftPercent = `${(splitRatio * 100).toFixed(2)}%`;
  const rightPercent = `${((1 - splitRatio) * 100).toFixed(2)}%`;

  return (
    <div
      ref={containerRef}
      className={`flex h-full flex-1 overflow-hidden ${isDragging ? "select-none" : ""}`}
    >
      {/* Left pane: conversation / agent */}
      <div className="flex flex-col overflow-hidden" style={{ width: leftPercent }}>
        {left}
      </div>

      {/* Divider — draggable split handle */}
      {/* biome-ignore lint/a11y/useSemanticElements: <hr> cannot serve as a draggable split handle */}
      <div
        role="separator"
        tabIndex={0}
        aria-valuenow={ratioToPercent(splitRatio)}
        aria-valuemin={20}
        aria-valuemax={80}
        aria-label="Resize split pane"
        className="group relative flex shrink-0 cursor-col-resize items-center justify-center"
        style={{ width: "5px" }}
        onMouseDown={onDividerMouseDown}
        onDoubleClick={onDividerDoubleClick}
      >
        {/* Visible line */}
        <div
          className={`h-full w-px transition-colors ${
            isDragging ? "bg-cyan-500/50" : "bg-white/[0.06] group-hover:bg-cyan-500/30"
          }`}
        />
        {/* Drag handle dots (visible on hover) */}
        <div className="absolute flex flex-col gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <div className="h-1 w-1 rounded-full bg-zinc-500" />
          <div className="h-1 w-1 rounded-full bg-zinc-500" />
          <div className="h-1 w-1 rounded-full bg-zinc-500" />
        </div>
      </div>

      {/* Right pane: git / markdown tabs */}
      <div className="flex flex-col overflow-hidden" style={{ width: rightPercent }}>
        {/* Tab bar */}
        <div className="flex shrink-0 items-center gap-1 border-b border-white/[0.06] px-3 py-1.5">
          <TabButton active={rightTab === "git"} onClick={() => onTabChange("git")}>
            Git
          </TabButton>
          <TabButton active={rightTab === "markdown"} onClick={() => onTabChange("markdown")}>
            Docs
          </TabButton>
          <TabButton active={rightTab === "flow"} onClick={() => onTabChange("flow")}>
            Flow
          </TabButton>
        </div>

        {/* Tab content */}
        <div className="flex flex-1 flex-col overflow-hidden">{right}</div>
      </div>
    </div>
  );
}
