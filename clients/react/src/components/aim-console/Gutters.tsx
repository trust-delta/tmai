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
  AIM_CONSOLE_CONV_WIDTH_MAX,
  AIM_CONSOLE_CONV_WIDTH_MIN,
  AIM_CONSOLE_FOOTER_MIN,
  AIM_CONSOLE_PR_WIDTH_MAX,
  AIM_CONSOLE_PR_WIDTH_MIN,
  clampAimConsoleConvWidth,
  clampAimConsolePrWidth,
} from "@/lib/ui-prefs";
import { cn } from "@/lib/utils";

// The footer may take at most 60% of the Session pane so the conversation
// never collapses under it. (The pane-width floors now live in the ui-prefs
// conv / pr clamps the gutters call directly.)
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
   *  zero-size layout mid-mount). */
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
    // (fire a resize on drag end).
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

/** Gutter A — Conversation|Aim. Rewrites `--conv` (the Conversation anchor
 *  width in px) from the live drag, clamped to the storage bounds (the CSS
 *  applies the live 62vw ceiling on top). `convWidth` (the committed anchor
 *  width) feeds aria-valuenow. */
export function ConvAimGutter({
  convWidth,
  onCommit,
  onReset,
}: {
  convWidth: number;
  onCommit: (conv: number) => void;
  onReset: () => void;
}) {
  const conv0Ref = useRef(0);
  const valueRef = useRef<number | null>(null);

  const onStart = useCallback((gutter: HTMLElement) => {
    const sessEl = rootOf(gutter)?.querySelector(".ac-session");
    if (!sessEl) return false;
    const conv0 = sessEl.getBoundingClientRect().width;
    if (conv0 <= 0) return false;
    conv0Ref.current = conv0;
    valueRef.current = null;
    return true;
  }, []);

  const onMove = useCallback((gutter: HTMLElement, delta: number) => {
    // Dragging right widens the conversation anchor.
    const conv = clampAimConsoleConvWidth(conv0Ref.current + delta);
    valueRef.current = conv;
    rootOf(gutter)?.style.setProperty("--conv", `${conv}px`);
    return `conv ${conv}px`;
  }, []);

  const onEnd = useCallback(() => {
    if (valueRef.current !== null) onCommit(valueRef.current);
  }, [onCommit]);

  const { live, readout, handlers } = useGutterDrag({ axis: "x", onStart, onMove, onEnd, onReset });

  return (
    // biome-ignore lint/a11y/useSemanticElements: a div is the draggable splitter
    <div
      className={cn("ac-vgut", live && "live")}
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label="Resize Conversation / Aim panes"
      aria-valuenow={Math.round(convWidth)}
      aria-valuemin={AIM_CONSOLE_CONV_WIDTH_MIN}
      aria-valuemax={AIM_CONSOLE_CONV_WIDTH_MAX}
      title="Drag to resize · double-click to reset"
      {...handlers}
    >
      <ReadoutChip readout={readout} />
    </div>
  );
}

/** Overlay edge handle — the LEFT edge of the floating Remote overlay drawer.
 *  Dragging it resizes the overlay width (`--pr`); on release AimConsole snaps
 *  it to DOCK if it was pulled wide enough (the "drag-to-dock" gesture). Unlike
 *  `AimRemoteGutter` (a grid track) this is absolutely positioned at the
 *  drawer's left edge (`right: var(--pr)`), so it only exists while overlaid. */
export function OverlayEdgeGutter({
  prWidth,
  onCommit,
  onReset,
  previewDock,
}: {
  prWidth: number;
  onCommit: (pr: number) => void;
  onReset: () => void;
  previewDock: (pr: number) => boolean;
}) {
  const pr0Ref = useRef(0);
  const valueRef = useRef<number | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);

  const onStart = useCallback((gutter: HTMLElement) => {
    const root = rootOf(gutter);
    const drawer = root?.querySelector(".ac-prfull");
    if (!root || !drawer) return false;
    rootRef.current = root;
    pr0Ref.current = drawer.getBoundingClientRect().width;
    valueRef.current = null;
    return true;
  }, []);

  const onMove = useCallback(
    (gutter: HTMLElement, delta: number) => {
      // Pointer left = wider overlay. On release the Aim-room guard decides the
      // mode (docks if it still fits beside Aim, floats otherwise). From OVERLAY
      // that is a FLIP when the current width would dock — surface it live.
      const pr = clampAimConsolePrWidth(pr0Ref.current - delta);
      valueRef.current = pr;
      const root = rootOf(gutter);
      root?.style.setProperty("--pr", `${pr}px`);
      const willFlip = previewDock(pr);
      root?.classList.toggle("remote-pending-flip", willFlip);
      return willFlip ? `remote ${pr}px · release to dock` : `remote ${pr}px`;
    },
    [previewDock],
  );

  const onEnd = useCallback(() => {
    rootRef.current?.classList.remove("remote-pending-flip");
    if (valueRef.current !== null) onCommit(valueRef.current);
  }, [onCommit]);

  const { live, readout, handlers } = useGutterDrag({ axis: "x", onStart, onMove, onEnd, onReset });

  return (
    // biome-ignore lint/a11y/useSemanticElements: a div is the draggable splitter
    <div
      className={cn("ac-ovgut", live && "live")}
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label="Resize Remote overlay"
      aria-valuenow={Math.round(prWidth)}
      aria-valuemin={AIM_CONSOLE_PR_WIDTH_MIN}
      aria-valuemax={AIM_CONSOLE_PR_WIDTH_MAX}
      title="Drag to resize · docks when it fits beside Aim · double-click to reset"
      {...handlers}
    >
      <ReadoutChip readout={readout} />
    </div>
  );
}

/** Gutter B — Aim|Remote. Adjusts `--pr` (px) while the Remote is DOCKED;
 *  inert (`off`) while collapsed or overlaid (the overlay drawer carries its
 *  own edge handle). `prWidth` (the committed Remote width) feeds
 *  aria-valuenow. */
export function AimRemoteGutter({
  active,
  prWidth,
  onCommit,
  onReset,
  previewDock,
}: {
  active: boolean;
  prWidth: number;
  onCommit: (pr: number) => void;
  onReset: () => void;
  previewDock: (pr: number) => boolean;
}) {
  const pr0Ref = useRef(0);
  const valueRef = useRef<number | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);

  const onStart = useCallback((gutter: HTMLElement) => {
    const root = rootOf(gutter);
    const prEl = root?.querySelector(".ac-pr");
    if (!root || !prEl) return false;
    rootRef.current = root;
    pr0Ref.current = prEl.getBoundingClientRect().width;
    valueRef.current = null;
    return true;
  }, []);

  const onMove = useCallback(
    (gutter: HTMLElement, delta: number) => {
      // The Remote grows leftwards: pointer left = wider panel. From DOCK,
      // releasing FLIPS to overlay when the width no longer fits beside Aim.
      const pr = clampAimConsolePrWidth(pr0Ref.current - delta);
      valueRef.current = pr;
      const root = rootOf(gutter);
      root?.style.setProperty("--pr", `${pr}px`);
      const willFlip = !previewDock(pr);
      root?.classList.toggle("remote-pending-flip", willFlip);
      return willFlip ? `remote ${pr}px · release to float` : `remote ${pr}px`;
    },
    [previewDock],
  );

  const onEnd = useCallback(() => {
    rootRef.current?.classList.remove("remote-pending-flip");
    if (valueRef.current !== null) onCommit(valueRef.current);
  }, [onCommit]);

  const { live, readout, handlers } = useGutterDrag({
    axis: "x",
    disabled: !active,
    onStart,
    onMove,
    onEnd,
    onReset,
  });

  return (
    // biome-ignore lint/a11y/useSemanticElements: a div is the draggable splitter
    <div
      className={cn("ac-vgut", !active && "off", live && "live")}
      role="separator"
      tabIndex={active ? 0 : -1}
      aria-orientation="vertical"
      aria-label="Resize Remote panel"
      aria-disabled={!active}
      aria-valuenow={Math.round(prWidth)}
      aria-valuemin={AIM_CONSOLE_PR_WIDTH_MIN}
      aria-valuemax={AIM_CONSOLE_PR_WIDTH_MAX}
      title={active ? "Drag to resize · double-click to reset" : undefined}
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
    const max = Math.round(sessionH * FOOTER_MAX_SESSION_RATIO);
    // A ceiling at or below the floor would INVERT onMove's
    // min(max(v, floor), ceiling) and drive --fh below the 110px minimum —
    // in that geometry (a very short Session pane) the drag must not start
    // at all. Same degenerate guard as BashFooter's window-resize re-clamp.
    if (max <= AIM_CONSOLE_FOOTER_MIN) return false;
    measureRef.current = {
      fh0: wrap.getBoundingClientRect().height,
      max,
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
    // biome-ignore lint/a11y/useSemanticElements: a div is the draggable splitter
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
