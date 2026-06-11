// Gutters — the aim-console's drag-resize affordances (S7).
//
// A faithful reproduction of the mock's drag-resize layer
// (`origin/mock/aim-ui-s6` → `assets/s6-conversation-panel-mock.html`,
// `gutA`/`gutB`/`gutF`): the 3-pane grid gains two REAL 5px gutter tracks
// (Aim|Session and Session|PR) and the bash footer a 5px horizontal height
// gutter. At rest each gutter shows the old hairline seam (1px centred in
// the track); hover lights a thin cyan glow + a grip glyph (`⋮` / `⋯`);
// while dragging the line goes solid cyan, the cursor turns col/row-resize
// window-wide, and a small mono readout chip follows the pointer with the
// live px values. Double-click resets that gutter's dimension(s) to the
// defaults. The Session|PR gutter is inert while the rail is collapsed
// (mock `.gut.off`).
//
// Drag mechanics: pointer capture on the gutter; per-move the CSS custom
// properties (`--aim`/`--sess` as px-weight fr values, `--pr` px on the
// `.aim-console` root; `--fh` px on the footer) are rewritten IMPERATIVELY —
// React state is NOT touched per pointermove, so a live drag never re-renders
// the pane subtrees (terminals). Only the readout chip (local to the gutter)
// re-renders. The final value is committed ONCE on pointerup via `onCommit`
// (→ ui-prefs persistence, the issue's "written on drag end, not per-move").

import { useCallback, useRef, useState } from "react";
import {
  AIM_CONSOLE_FOOTER_MIN,
  AIM_CONSOLE_PR_WIDTH_MAX,
  AIM_CONSOLE_PR_WIDTH_MIN,
  clampAimConsolePrWidth,
} from "@/lib/ui-prefs";
import { cn } from "@/lib/utils";

// Drag clamps (mock gutA/gutF): pane floors keep the Aim worklist and the
// Session conversation usable at the extremes; the footer may take at most
// 60% of the Session pane so the conversation never collapses under it.
export const AIM_PANE_MIN_PX = 230;
export const SESSION_PANE_MIN_PX = 300;
export const FOOTER_MAX_SESSION_RATIO = 0.6;

interface ReadoutState {
  x: number;
  y: number;
  text: string;
}

interface GutterDragSpec {
  axis: "x" | "y";
  /** Inert gutter (mock `.gut.off`) — pointer-events are off in CSS, but the
   *  JS guard matters too: programmatic events (tests) bypass CSS hit-testing. */
  disabled?: boolean;
  /** Measure the panes at drag start. Return false to abort (degenerate
   *  zero-size layout mid-mount — same guard useSplitPane carries). */
  onStart: (gutter: HTMLElement) => boolean;
  /** Apply the live value for a pointer delta (px along the axis) and return
   *  the readout chip text. */
  onMove: (gutter: HTMLElement, delta: number) => string;
  /** Commit the final value — fired once, on pointerup/cancel. */
  onEnd: () => void;
  /** Double-click reset to defaults. */
  onReset: () => void;
}

// Shared pointer plumbing for all three gutters: capture, live/readout state,
// and the root drag classes (the mock's `body.dragging drag-col/drag-row`,
// kept on `.aim-console` so everything stays inside the scope boundary —
// cursor override, text-selection suppression, and grid/footer transition
// suppression all hang off them).
function useGutterDrag({ axis, disabled, onStart, onMove, onEnd, onReset }: GutterDragSpec) {
  const [live, setLive] = useState(false);
  const [readout, setReadout] = useState<ReadoutState | null>(null);
  const liveRef = useRef(false);
  const startRef = useRef(0);

  const setRootDragging = useCallback(
    (gutter: HTMLElement, on: boolean) => {
      const root = gutter.closest(".aim-console");
      root?.classList.toggle("ac-dragging", on);
      root?.classList.toggle(axis === "x" ? "ac-drag-col" : "ac-drag-row", on);
    },
    [axis],
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || liveRef.current || e.button !== 0) return;
    const gutter = e.currentTarget;
    if (!onStart(gutter)) return;
    startRef.current = axis === "x" ? e.clientX : e.clientY;
    try {
      gutter.setPointerCapture(e.pointerId);
    } catch {
      // jsdom has no pointer capture; real browsers route every move here.
    }
    liveRef.current = true;
    setLive(true);
    setRootDragging(gutter, true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!liveRef.current) return;
    const pos = axis === "x" ? e.clientX : e.clientY;
    const text = onMove(e.currentTarget, pos - startRef.current);
    setReadout({ x: e.clientX, y: e.clientY, text });
  };

  const handlePointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!liveRef.current) return;
    const gutter = e.currentTarget;
    try {
      gutter.releasePointerCapture(e.pointerId);
    } catch {
      // jsdom — see above.
    }
    liveRef.current = false;
    setLive(false);
    setReadout(null);
    setRootDragging(gutter, false);
    onEnd();
    // Let xterm + other ResizeObserver users re-measure the settled tracks
    // (the same convention as useSplitPane's drag end).
    window.dispatchEvent(new Event("resize"));
  };

  const handleDoubleClick = () => {
    if (disabled) return;
    onReset();
  };

  return {
    live,
    readout,
    handlers: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerEnd,
      onPointerCancel: handlePointerEnd,
      onDoubleClick: handleDoubleClick,
    },
  };
}

// The drag readout chip (mock `#readout`) — fixed-positioned, offset from the
// pointer; pointer-events:none so it never steals the capture. Rendered
// INSIDE the gutter element so the gutter stays a single grid/flex child.
function ReadoutChip({ readout }: { readout: ReadoutState | null }) {
  if (!readout) return null;
  return (
    <div
      className="ac-readout"
      data-testid="ac-gutter-readout"
      style={{ left: readout.x + 14, top: readout.y + 14 }}
    >
      {readout.text}
    </div>
  );
}

function rootOf(gutter: HTMLElement): HTMLElement | null {
  return gutter.closest<HTMLElement>(".aim-console");
}

/** Gutter A — Aim|Session. Rewrites BOTH fr tracks from the live px split
 *  (mock gutA), so the two panes keep window-scaling after the drag while
 *  honouring the px floors at drag time. `aimShare` (the committed Aim share
 *  of the two panes, 0–100) feeds aria-valuenow. */
export function AimSessionGutter({
  aimShare,
  onCommit,
  onReset,
}: {
  aimShare: number;
  onCommit: (aim: number, sess: number) => void;
  onReset: () => void;
}) {
  const measureRef = useRef({ aim0: 0, total: 0 });
  const valueRef = useRef<{ aim: number; sess: number } | null>(null);

  const onStart = useCallback((gutter: HTMLElement) => {
    const root = rootOf(gutter);
    const aimEl = root?.querySelector(".ac-aim");
    const sessEl = root?.querySelector(".ac-session");
    if (!aimEl || !sessEl) return false;
    const aim0 = aimEl.getBoundingClientRect().width;
    const total = aim0 + sessEl.getBoundingClientRect().width;
    if (total <= 0) return false;
    measureRef.current = { aim0, total };
    valueRef.current = null;
    return true;
  }, []);

  const onMove = useCallback((gutter: HTMLElement, delta: number) => {
    const { aim0, total } = measureRef.current;
    const aim = Math.round(
      Math.min(Math.max(aim0 + delta, AIM_PANE_MIN_PX), total - SESSION_PANE_MIN_PX),
    );
    const sess = Math.round(total) - aim;
    valueRef.current = { aim, sess };
    const root = rootOf(gutter);
    root?.style.setProperty("--aim", `${aim}fr`);
    root?.style.setProperty("--sess", `${sess}fr`);
    return `aim ${aim}px · sess ${sess}px`;
  }, []);

  const onEnd = useCallback(() => {
    const v = valueRef.current;
    if (v) onCommit(v.aim, v.sess);
  }, [onCommit]);

  const { live, readout, handlers } = useGutterDrag({ axis: "x", onStart, onMove, onEnd, onReset });

  return (
    // biome-ignore lint/a11y/useSemanticElements: a div is the draggable splitter (RPanel precedent)
    <div
      className={cn("ac-vgut", live && "live")}
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label="Resize Aim / Session panes"
      aria-valuenow={Math.round(aimShare)}
      aria-valuemin={0}
      aria-valuemax={100}
      title="Drag to resize · double-click to reset"
      {...handlers}
    >
      <ReadoutChip readout={readout} />
    </div>
  );
}

/** Gutter B — Session|PR rail. Adjusts `--pr` (px) while the rail is open;
 *  inert (`off`) while it is collapsed to the 46px rail (mock gutB).
 *  `prWidth` (the committed rail width) feeds aria-valuenow. */
export function SessionPrGutter({
  open,
  prWidth,
  onCommit,
  onReset,
}: {
  open: boolean;
  prWidth: number;
  onCommit: (pr: number) => void;
  onReset: () => void;
}) {
  const pr0Ref = useRef(0);
  const valueRef = useRef<number | null>(null);

  const onStart = useCallback((gutter: HTMLElement) => {
    const prEl = rootOf(gutter)?.querySelector(".ac-pr");
    if (!prEl) return false;
    pr0Ref.current = prEl.getBoundingClientRect().width;
    valueRef.current = null;
    return true;
  }, []);

  const onMove = useCallback((gutter: HTMLElement, delta: number) => {
    // The rail grows leftwards: pointer left = wider rail.
    const pr = clampAimConsolePrWidth(pr0Ref.current - delta);
    valueRef.current = pr;
    rootOf(gutter)?.style.setProperty("--pr", `${pr}px`);
    return `pr ${pr}px`;
  }, []);

  const onEnd = useCallback(() => {
    if (valueRef.current !== null) onCommit(valueRef.current);
  }, [onCommit]);

  const { live, readout, handlers } = useGutterDrag({
    axis: "x",
    disabled: !open,
    onStart,
    onMove,
    onEnd,
    onReset,
  });

  return (
    // biome-ignore lint/a11y/useSemanticElements: a div is the draggable splitter (RPanel precedent)
    <div
      className={cn("ac-vgut", !open && "off", live && "live")}
      role="separator"
      tabIndex={open ? 0 : -1}
      aria-orientation="vertical"
      aria-label="Resize PR rail"
      aria-disabled={!open}
      aria-valuenow={Math.round(prWidth)}
      aria-valuemin={AIM_CONSOLE_PR_WIDTH_MIN}
      aria-valuemax={AIM_CONSOLE_PR_WIDTH_MAX}
      title={open ? "Drag to resize · double-click to reset" : undefined}
      {...handlers}
    >
      <ReadoutChip readout={readout} />
    </div>
  );
}

/** Gutter F — bash-footer height. Sits directly above the footer (only while
 *  it is expanded); rewrites the footer's `--fh` (the terminal-area height,
 *  mock gutF), clamped to [110px, 60% of the Session pane]. */
export function FooterGutter({
  footerHeight,
  onCommit,
  onReset,
}: {
  /** Committed terminal-area height (px) — feeds aria-valuenow. */
  footerHeight: number;
  onCommit: (footer: number) => void;
  onReset: () => void;
}) {
  const measureRef = useRef<{ fh0: number; max: number; footer: HTMLElement } | null>(null);
  const valueRef = useRef<number | null>(null);

  const onStart = useCallback((gutter: HTMLElement) => {
    const session = gutter.closest<HTMLElement>(".ac-session");
    const footer = session?.querySelector<HTMLElement>(".ac-footer");
    const wrap = session?.querySelector(".ac-ftwrap");
    if (!session || !footer || !wrap) return false;
    const sessionH = session.getBoundingClientRect().height;
    if (sessionH <= 0) return false;
    measureRef.current = {
      fh0: wrap.getBoundingClientRect().height,
      max: Math.round(sessionH * FOOTER_MAX_SESSION_RATIO),
      footer,
    };
    valueRef.current = null;
    return true;
  }, []);

  const onMove = useCallback((_gutter: HTMLElement, delta: number) => {
    const m = measureRef.current;
    if (!m) return "";
    // Dragging UP (negative delta) grows the footer.
    const fh = Math.round(Math.min(Math.max(m.fh0 - delta, AIM_CONSOLE_FOOTER_MIN), m.max));
    valueRef.current = fh;
    m.footer.style.setProperty("--fh", `${fh}px`);
    return `footer ${fh}px`;
  }, []);

  const onEnd = useCallback(() => {
    if (valueRef.current !== null) onCommit(valueRef.current);
  }, [onCommit]);

  const { live, readout, handlers } = useGutterDrag({ axis: "y", onStart, onMove, onEnd, onReset });

  return (
    // biome-ignore lint/a11y/useSemanticElements: a div is the draggable splitter (RPanel precedent)
    <div
      className={cn("ac-hgut", live && "live")}
      role="separator"
      tabIndex={0}
      aria-orientation="horizontal"
      aria-label="Resize bash footer height"
      aria-valuenow={Math.round(footerHeight)}
      aria-valuemin={AIM_CONSOLE_FOOTER_MIN}
      title="Drag to resize · double-click to reset"
      {...handlers}
    >
      <ReadoutChip readout={readout} />
    </div>
  );
}
