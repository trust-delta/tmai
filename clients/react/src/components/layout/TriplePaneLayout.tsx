import type { ReactNode } from "react";
import { makeSplitKeyHandler, RATIO_STEP, useSplitPane } from "@/hooks/useSplitPane";
import { useUIPref } from "@/lib/ui-prefs-provider";

interface TriplePaneLayoutProps {
  preview: ReactNode;
  git: ReactNode;
  markdown: ReactNode;
}

interface DividerProps {
  orientation: "horizontal" | "vertical";
  isDragging: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onAdjust: (delta: number) => void;
  ratio: number;
}

function ratioToPercent(ratio: number): number {
  return Math.round(ratio * 100);
}

function Divider({
  orientation,
  isDragging,
  onMouseDown,
  onDoubleClick,
  onAdjust,
  ratio,
}: DividerProps) {
  const isHorizontal = orientation === "horizontal";
  const onKeyDown = makeSplitKeyHandler(orientation, RATIO_STEP, onAdjust);
  const containerClass = isHorizontal
    ? "group relative flex shrink-0 cursor-col-resize items-center justify-center"
    : "group relative flex shrink-0 cursor-row-resize items-center justify-center";
  const containerStyle = isHorizontal ? { width: "5px" } : { height: "5px" };
  const lineClass = isHorizontal
    ? `h-full w-px transition-colors ${
        isDragging ? "bg-cyan-500/50" : "bg-white/[0.06] group-hover:bg-cyan-500/30"
      }`
    : `h-px w-full transition-colors ${
        isDragging ? "bg-cyan-500/50" : "bg-white/[0.06] group-hover:bg-cyan-500/30"
      }`;
  return (
    // biome-ignore lint/a11y/useSemanticElements: <hr> cannot serve as a draggable split handle
    <div
      role="separator"
      tabIndex={0}
      aria-valuenow={ratioToPercent(ratio)}
      aria-valuemin={20}
      aria-valuemax={80}
      aria-label="Resize pane"
      aria-orientation={isHorizontal ? "vertical" : "horizontal"}
      className={containerClass}
      style={containerStyle}
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
    >
      <div className={lineClass} />
    </div>
  );
}

// Three-pane grid: preview occupies the left column; git/markdown stack
// in the right column. Composes two independent useSplitPane instances so
// the outer (column) and inner (row) ratios drag separately.
export function TriplePaneLayout({ preview, git, markdown }: TriplePaneLayoutProps) {
  const [outerRatio, setOuterRatio] = useUIPref("tripleOuterRatio");
  const [innerRatio, setInnerRatio] = useUIPref("tripleInnerRatio");
  const outer = useSplitPane({
    orientation: "horizontal",
    initialRatio: outerRatio,
    onCommit: setOuterRatio,
  });
  const inner = useSplitPane({
    orientation: "vertical",
    initialRatio: innerRatio,
    onCommit: setInnerRatio,
  });

  const leftPercent = `${(outer.splitRatio * 100).toFixed(2)}%`;
  const rightPercent = `${((1 - outer.splitRatio) * 100).toFixed(2)}%`;
  const topPercent = `${(inner.splitRatio * 100).toFixed(2)}%`;
  const bottomPercent = `${((1 - inner.splitRatio) * 100).toFixed(2)}%`;

  const isAnyDragging = outer.isDragging || inner.isDragging;

  return (
    <div
      ref={outer.containerRef}
      className={`flex h-full flex-1 overflow-hidden ${isAnyDragging ? "select-none" : ""}`}
    >
      <div className="flex flex-col overflow-hidden" style={{ width: leftPercent }}>
        {preview}
      </div>

      <Divider
        orientation="horizontal"
        isDragging={outer.isDragging}
        onMouseDown={outer.onDividerMouseDown}
        onDoubleClick={outer.onDividerDoubleClick}
        onAdjust={outer.adjustRatio}
        ratio={outer.splitRatio}
      />

      <div
        ref={inner.containerRef}
        className="flex flex-col overflow-hidden"
        style={{ width: rightPercent }}
      >
        <div className="flex flex-col overflow-hidden" style={{ height: topPercent }}>
          <div className="flex shrink-0 items-center gap-1 border-b border-white/[0.06] px-3 py-1.5">
            <span className="rounded-md px-3 py-1 text-xs font-medium text-cyan-400">Git</span>
          </div>
          <div className="flex flex-1 flex-col overflow-hidden">{git}</div>
        </div>

        <Divider
          orientation="vertical"
          isDragging={inner.isDragging}
          onMouseDown={inner.onDividerMouseDown}
          onDoubleClick={inner.onDividerDoubleClick}
          onAdjust={inner.adjustRatio}
          ratio={inner.splitRatio}
        />

        <div className="flex flex-col overflow-hidden" style={{ height: bottomPercent }}>
          <div className="flex shrink-0 items-center gap-1 border-b border-white/[0.06] px-3 py-1.5">
            <span className="rounded-md px-3 py-1 text-xs font-medium text-cyan-400">Docs</span>
          </div>
          <div className="flex flex-1 flex-col overflow-hidden">{markdown}</div>
        </div>
      </div>
    </div>
  );
}
