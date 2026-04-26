import { AnsiUp } from "ansi_up";
import DOMPurify from "dompurify";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { QueueBadge } from "@/components/ui/QueueBadge";
import { QueuePopover } from "@/components/ui/QueuePopover";
import { useQueuedPrompts } from "@/hooks/useQueuedPrompts";
import { api } from "@/lib/api";
import type { PreviewSettingsResponse, QueuedPrompt, TranscriptRecord } from "@/lib/api-http";
import type { ActionOrigin } from "@/types";
import {
  capHistoryLines,
  charColumns,
  shrinkContentToWidth,
  splitPreviewContent,
  trimPreviewContent,
} from "./preview-content";

// Maximum number of scrollback lines rendered in the history region.
// Anything older is dropped at render time to keep AnsiUp → DOMPurify →
// innerHTML bounded regardless of how long the agent has been running.
// Operators can still see the live region + most recent scrollback; the
// capped-off prefix is surfaced via a tiny header so they know it exists.
//
// Empirically 2000 lines still caused noticeable stutter on the first
// mount for agents with heavy Markdown/ANSI output. 1000 is low enough
// that the AnsiUp pipeline completes in ~50ms on the reporter's machine
// while keeping enough scrollback to debug recent tool output.
const MAX_HISTORY_LINES = 1000;

interface PreviewPanelProps {
  agentId: string;
}

// Map browser KeyboardEvent to tmux key name for special keys
function toTmuxKey(e: KeyboardEvent): string | null {
  if (e.ctrlKey && e.key.length === 1) return `C-${e.key.toLowerCase()}`;
  switch (e.key) {
    case "Enter":
      return e.ctrlKey ? "C-m" : "Enter";
    case "Escape":
      return "Escape";
    case "Backspace":
      return "BSpace";
    case "Tab":
      return e.shiftKey ? "BTab" : "Tab";
    case "ArrowUp":
      return "Up";
    case "ArrowDown":
      return "Down";
    case "ArrowLeft":
      return "Left";
    case "ArrowRight":
      return "Right";
    case "Home":
      return "Home";
    case "End":
      return "End";
    case "PageUp":
      return "PageUp";
    case "PageDown":
      return "PageDown";
    case "Delete":
      return "DC";
    case " ":
      return "Space";
    default:
      return null;
  }
}

// Render an ActionOrigin discriminated union as a compact label, e.g.
// "Human:webui", "Agent:main:0.0", "System:pr_monitor"
function originLabel(o: ActionOrigin): string {
  switch (o.kind) {
    case "Human":
      return `Human:${o.interface}`;
    case "Agent":
      return `Agent:${o.id}`;
    case "System":
      return `System:${o.subsystem}`;
  }
}

// Per-agent auto-scroll preference (persists across agent switches)
const agentAutoScrollMap = new Map<string, boolean>();

const MONO_FONT_STACK =
  "'JetBrainsMono Nerd Font', 'JetBrainsMono NF', " +
  "'CaskaydiaCove Nerd Font', 'CaskaydiaCove NF', " +
  "'FiraCode Nerd Font', 'FiraCode NF', " +
  "'MesloLGS NF', 'Hack Nerd Font', " +
  "'JetBrains Mono', 'Cascadia Code', 'Fira Code', " +
  "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, " +
  "'Liberation Mono', 'Courier New', " +
  "'Symbols Nerd Font Mono', monospace";

// Interactive terminal preview with passthrough input.
// Renders capture-pane output with ANSI colors and forwards keystrokes
// to the agent's terminal. Passthrough is button-controlled.
// IME (Japanese, Chinese, etc.) is supported via a hidden input element.
// Cursor position from the backend (terminal cursor, 0-indexed)
interface CursorPos {
  x: number;
  y: number;
}

import { TranscriptView } from "./TranscriptView";

export function PreviewPanel({ agentId }: PreviewPanelProps) {
  // Preview is split into two regions so scrollback history (immutable,
  // often >1MB) is not re-parsed through AnsiUp / DOMPurify / innerHTML on
  // every poll tick — the dominant input-lag cost in long sessions (#413).
  // `history` changes rarely (only when new output scrolls off the top);
  // `live` covers the visible capture-pane region and updates each tick.
  const [history, setHistory] = useState<string>("");
  const [live, setLive] = useState<string>("");
  const [liveStartLine, setLiveStartLine] = useState<number>(0);
  const [transcriptRecords, setTranscriptRecords] = useState<TranscriptRecord[]>([]);
  // "live" = capture-pane (cheap, default). "transcript" = JSONL records
  // (heavy: per-record react-markdown). Splitting them into tabs keeps the
  // common monitoring path light, and the transcript polling/render only
  // runs when the user actively opens it.
  const [activeTab, setActiveTab] = useState<"live" | "transcript">("live");
  const [cursorPos, setCursorPos] = useState<CursorPos | null>(null);
  const [showCursor, setShowCursor] = useState(true);
  const [focused, setFocused] = useState(true);
  const [queueOpen, setQueueOpen] = useState(false);
  // Track the most-recently-arrived queued prompt to show an inline warning
  // that is isolated from the conversation input (fixes #9).
  const [incomingPrompt, setIncomingPrompt] = useState<string | null>(null);
  const incomingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleNewQueueItem = useCallback((item: QueuedPrompt) => {
    setIncomingPrompt(item.prompt);
    if (incomingTimerRef.current) clearTimeout(incomingTimerRef.current);
    incomingTimerRef.current = setTimeout(() => setIncomingPrompt(null), 5000);
  }, []);
  const { items: queueItems, cancel: cancelQueueItem } = useQueuedPrompts(
    agentId,
    handleNewQueueItem,
  );
  const [composing, setComposing] = useState(false);
  // Mirror `composing` into a ref so fetchPreview / poll-tick closures can
  // read the current composition state without being re-created (which
  // would restart the poll timer and disrupt IME UI timing).
  const composingRef = useRef(false);
  useEffect(() => {
    composingRef.current = composing;
  }, [composing]);

  // Latest raw content payload, used to skip the split/render path when
  // the backend returned byte-identical content. Preview responses can
  // be hundreds of KB to several MB (Hybrid Scrollback).
  const lastContentRef = useRef<string | null>(null);

  const [autoScroll, setAutoScrollRaw] = useState(() => agentAutoScrollMap.get(agentId) ?? true);

  // Wrap setter to persist preference per agent
  const setAutoScroll = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) => {
      setAutoScrollRaw((prev) => {
        const next = typeof v === "function" ? v(prev) : v;
        agentAutoScrollMap.set(agentId, next);
        return next;
      });
    },
    [agentId],
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // Tracks whether the current mousedown originated in input mode and triggered
  // a preemptive enterSelectMode(). On mouseup we check this to cancel the
  // mode switch when no text was actually selected (plain click, no drag).
  const pendingSelectRef = useRef(false);

  // Measure character columns that fit in the preview container
  const [cols, setCols] = useState(0);
  const measureRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const measure = () => {
      const span = measureRef.current;
      if (!span) return;
      const charW = span.getBoundingClientRect().width;
      if (charW > 0) {
        // Subtract horizontal padding (p-3 = 12px each side)
        const available = el.clientWidth - 24;
        setCols(Math.floor(available / charW));
      }
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);
  const ansi = useMemo(() => {
    const a = new AnsiUp();
    a.use_classes = true;
    return a;
  }, []);

  // Default polling intervals (overridden by server settings)
  const pollSettings = useRef<PreviewSettingsResponse>({
    show_cursor: true,
    preview_poll_focused_ms: 200,
    preview_poll_unfocused_ms: 2000,
    preview_poll_active_input_ms: 50,
    preview_active_input_window_ms: 2000,
  });

  // Timestamp of the last passthrough input event
  const lastInputTime = useRef(0);

  // Load preview settings (cursor visibility + poll intervals) from server
  useEffect(() => {
    api
      .getPreviewSettings()
      .then((s) => {
        setShowCursor(s.show_cursor);
        pollSettings.current = s;
      })
      .catch(() => {});
  }, []);

  // Reset state when switching agents (autoScroll restored from per-agent map)
  useEffect(() => {
    setHistory("");
    setLive("");
    setLiveStartLine(0);
    setTranscriptRecords([]);
    setCursorPos(null);
    setFocused(true);
    setHasDomFocus(true);
    setAutoScrollRaw(agentAutoScrollMap.get(agentId) ?? true);
    setComposing(false);
    lastContentRef.current = null;
    lastHistoryHtmlRef.current = "";
    lastLiveHtmlRef.current = "";
  }, [agentId]);

  // Switch to input mode (passthrough ON)
  const enterInputMode = useCallback(() => {
    setFocused(true);
  }, []);

  // Switch to select mode (passthrough OFF, text selection enabled)
  const enterSelectMode = useCallback(() => {
    setFocused(false);
  }, []);

  // Track whether the PreviewPanel's container has DOM focus (or contains the focused element).
  // When the user clicks the right panel in split-pane view, the container loses focus
  // and we should remove the focus ring and cursor overlay.
  const [hasDomFocus, setHasDomFocus] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onFocusIn = () => setHasDomFocus(true);
    const onFocusOut = (e: FocusEvent) => {
      // Only lose focus if the new target is outside the container
      if (!container.contains(e.relatedTarget as Node)) {
        setHasDomFocus(false);
        setFocused(false);
      }
    };
    container.addEventListener("focusin", onFocusIn);
    container.addEventListener("focusout", onFocusOut);
    return () => {
      container.removeEventListener("focusin", onFocusIn);
      container.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  // In select mode, listen for Enter key on the container to switch to input mode
  useEffect(() => {
    if (focused) return;
    const container = containerRef.current;
    if (!container) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        enterInputMode();
      }
    };
    container.addEventListener("keydown", onKeyDown);
    return () => container.removeEventListener("keydown", onKeyDown);
  }, [focused, enterInputMode]);

  // Focus/blur the hidden input when mode changes
  useEffect(() => {
    if (focused) {
      const timer = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    } else {
      inputRef.current?.blur();
    }
  }, [focused]);

  // Polling interval: short (active_input_ms) for a window after every
  // keystroke, then focused (default 500ms), otherwise unfocused (2s).
  // The keystroke-triggered 50ms/200ms fetches alone don't cover the
  // visible lag that shows up when the backend rewrites the preview a
  // bit later (tmux repaint after send-keys); the active-input window
  // keeps the preview caught up while the user is actively typing.
  // Preview polling cadence: focused vs unfocused only. Keystroke-driven
  // post-passthrough fetches (50ms + 200ms) complement the steady poll.
  const getPollInterval = useCallback(() => {
    const s = pollSettings.current;
    return focused ? s.preview_poll_focused_ms : s.preview_poll_unfocused_ms;
  }, [focused]);

  // Fetch preview content, shared between polling and post-keystroke refresh.
  // Skips DOM update while user has an active text selection, or while an
  // IME composition is in progress — re-rendering the preview during
  // composition disrupts the IME candidate window and causes visible
  // typing lag in CJK input methods.
  const fetchPreview = useCallback(async () => {
    if (composingRef.current) return;
    try {
      const data = await api.getPreview(agentId);
      // Treat only null/undefined as "no payload" — an empty string is
      // still a real preview state we should write through, otherwise
      // an idle agent's quiet output keeps the UI pinned on
      // "Waiting for output..." after an agent switch.
      if (data.content == null) return;
      const sel = window.getSelection();
      if (sel && sel.toString().length > 0) return;
      // Split scrollback history from the live visible region so the history
      // path stays out of the hot render loop (#413). `history` updates only
      // when it actually changed — React bails on setState with identical
      // primitives, which skips the heavy history memo downstream.
      if (data.content !== lastContentRef.current) {
        lastContentRef.current = data.content;
        const split = splitPreviewContent(data.content, data.live_start_line ?? 0);
        setHistory((prev) => (prev === split.history ? prev : split.history));
        setLive((prev) => (prev === split.live ? prev : split.live));
        setLiveStartLine((prev) =>
          prev === (data.live_start_line ?? 0) ? prev : (data.live_start_line ?? 0),
        );
      }
      if (data.cursor_x != null && data.cursor_y != null) {
        setCursorPos((prev) =>
          prev?.x === data.cursor_x && prev?.y === data.cursor_y
            ? prev
            : { x: data.cursor_x as number, y: data.cursor_y as number },
        );
      } else {
        setCursorPos((prev) => (prev === null ? prev : null));
      }
    } catch {
      // Agent may not have content yet
    }
  }, [agentId]);

  // Self-rescheduling poll loop: recalculates interval each tick so it adapts
  // to active-input vs focused vs unfocused state without re-mounting.
  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      fetchPreview();
      const next = getPollInterval();
      timer = setTimeout(tick, next);
    };
    let timer = setTimeout(tick, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [fetchPreview, getPollInterval]);

  // Fetch transcript records (slower cadence — history changes less often).
  // Skip the state update when the incoming records array matches what we
  // already have — the TranscriptView is heavy (per-record react-markdown)
  // and a needless 3s setState rebuilds the subtree even though nothing
  // changed semantically. We detect "no change" by length plus the tail
  // record's uuid, which is sufficient for an append-only transcript.
  const fetchTranscript = useCallback(async () => {
    try {
      const data = await api.getTranscript(agentId);
      if (data.records && data.records.length > 0) {
        const fetched = data.records;
        setTranscriptRecords((prev) => {
          if (
            prev.length === fetched.length &&
            prev[prev.length - 1]?.uuid === fetched[fetched.length - 1]?.uuid
          ) {
            return prev;
          }
          return fetched;
        });
      }
    } catch {
      // Transcript not available (no hook connection, etc.)
    }
  }, [agentId]);

  // Only fetch transcript while the Transcript tab is active. The Live tab
  // never needs the JSONL records, so we avoid the 3s polling and the
  // per-record react-markdown re-render entirely while the user is just
  // monitoring the agent.
  useEffect(() => {
    if (activeTab !== "transcript") return;
    fetchTranscript();
    const interval = setInterval(fetchTranscript, 3000);
    return () => clearInterval(interval);
  }, [fetchTranscript, activeTab]);

  // Pending passthrough refresh timers (cleared on agent switch / unmount)
  const passthroughTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally clear timers on agent switch
  useEffect(() => {
    return () => {
      for (const t of passthroughTimers.current) clearTimeout(t);
      passthroughTimers.current = [];
    };
  }, [agentId]);

  // Reset preview state on agent switch so the previous agent's
  // capture-pane / transcript don't flash on screen until the first
  // fetchPreview / fetchTranscript for the new agent comes back.
  // Also kick off an immediate fetch — the poll-loop useEffect will
  // re-mount and fire `setTimeout(tick, 0)` too, but for an idle
  // agent (no live output, content rarely changes) the difference
  // between "fire immediately" and "wait for the next React tick +
  // setTimeout schedule" was visible as a long-lived "Waiting…" state.
  useEffect(() => {
    setHistory("");
    setLive("");
    setLiveStartLine(0);
    setTranscriptRecords([]);
    setCursorPos(null);
    lastContentRef.current = null;
    void fetchPreview();
  }, [agentId, fetchPreview]);

  // Clear incoming-prompt indicator on agent switch and on unmount
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally clear on agent switch
  useEffect(() => {
    return () => {
      if (incomingTimerRef.current) clearTimeout(incomingTimerRef.current);
      setIncomingPrompt(null);
    };
  }, [agentId]);

  // Send passthrough input then refresh preview with two-stage fetch
  // for responsive cursor tracking
  const sendPassthrough = useCallback(
    (input: { chars?: string; key?: string }) => {
      lastInputTime.current = Date.now();
      api
        .passthrough(agentId, input)
        .then(() => {
          // Two-stage fetch: fast attempt + delayed retry for cursor accuracy
          const t1 = setTimeout(fetchPreview, 50);
          const t2 = setTimeout(fetchPreview, 200);
          passthroughTimers.current.push(t1, t2);
        })
        .catch(() => {});
    },
    [agentId, fetchPreview],
  );

  // Auto-scroll to bottom (toggleable, default on)
  // Scroll up → auto OFF, scroll to bottom → auto ON
  // skipNextScrollEventRef suppresses the synthetic onScroll the browser
  // fires when a tab toggle changes scrollHeight (which would otherwise
  // flip autoScroll off without any user gesture).
  const skipNextScrollEventRef = useRef(false);
  const handleScroll = useCallback(() => {
    if (skipNextScrollEventRef.current) {
      skipNextScrollEventRef.current = false;
      return;
    }
    const el = scrollContainerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    setAutoScroll(atBottom);
  }, [setAutoScroll]);

  // Mirror autoScroll into a ref so the tab-switch effect can read the
  // current value without re-running every time autoScroll changes.
  const autoScrollRef = useRef(autoScroll);
  useEffect(() => {
    autoScrollRef.current = autoScroll;
  }, [autoScroll]);

  // On switching back to the Live tab: suppress the tab-toggle's synthetic
  // onScroll, and if autoScroll was on, re-pin to the bottom so resumption
  // matches the user's intent ("auto" stays auto across tab switches).
  useEffect(() => {
    if (activeTab !== "live") return;
    skipNextScrollEventRef.current = true;
    if (!autoScrollRef.current) return;
    const id = requestAnimationFrame(() => {
      const el = scrollContainerRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(id);
  }, [activeTab]);

  // Handle special keys (non-IME) via the hidden input's keydown
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      // Don't intercept during IME composition
      if (composing) return;

      // Allow Ctrl+C to copy when there is a text selection
      if (e.ctrlKey && e.key === "c") {
        const sel = window.getSelection();
        if (sel && sel.toString().length > 0) return; // let browser handle copy
      }

      // Allow Ctrl+V to paste via browser — the pasted text will arrive
      // through the hidden input's onInput handler and be sent as passthrough
      if (e.ctrlKey && e.key === "v") return;

      const tmuxKey = toTmuxKey(e.nativeEvent);
      if (tmuxKey) {
        e.preventDefault();
        sendPassthrough({ key: tmuxKey });
        return;
      }

      // Single ASCII character (non-IME) — send directly, clear input
      if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        sendPassthrough({ chars: e.key });
      }
    },
    [composing, sendPassthrough],
  );

  // Handle IME confirmed text via input event
  const handleInput = useCallback(
    (e: React.FormEvent<HTMLInputElement>) => {
      const input = e.currentTarget;
      const value = input.value;
      if (value && !composing) {
        // IME confirmed or direct paste — send the full text
        sendPassthrough({ chars: value });
        input.value = "";
      }
    },
    [
      composing, // IME confirmed or direct paste — send the full text
      sendPassthrough,
    ],
  );

  // History HTML: heavy path (AnsiUp on potentially 1MB+ of text). Memoized
  // on the `history` string so it only re-runs when scrollback actually
  // grew — not on every poll tick that re-fetches identical scrollback
  // alongside fresh live output. This is the core of the #413 fix.
  //
  // Additional guardrail: we cap to MAX_HISTORY_LINES before running the
  // AnsiUp pipeline. Without the cap, a long-running worker's scrollback
  // can balloon past 10k lines and the first mount (or any subsequent
  // `history` change) freezes the tab for seconds — the dominant cause of
  // the "Agent panel opens and freezes" reports.
  //
  // Trailing-blank-line stripping is intentionally skipped here: blank lines
  // at the history/live boundary may be real printed blanks, not cosmetic.
  // Defer the history-triggered renders behind React 19's concurrent
  // prioritization. The live region state (updated every 200ms by the poll
  // loop) stays on the synchronous path so the terminal feels responsive;
  // history updates (which pull in the AnsiUp → DOMPurify → innerHTML
  // pipeline) are allowed to land on the next idle frame, letting the
  // browser service input and paint the live region first. This is what
  // keeps the tab from locking up while a chatty worker is scrolling
  // content off the top of the live region multiple times per second.
  const deferredHistory = useDeferredValue(history);
  const historyCap = useMemo(
    () => capHistoryLines(deferredHistory, MAX_HISTORY_LINES),
    [deferredHistory],
  );

  // History HTML conversion happens off the main thread via a Web Worker
  // (lib/ansi-worker.ts). For a long-running agent the scrollback can
  // reach hundreds of KB and the synchronous AnsiUp pass would block the
  // tab for several seconds on every poll tick. The worker lets the Live
  // region keep painting and input keep responding while the History
  // pipeline catches up. Each request carries an incrementing id; a
  // response whose id no longer matches the latest request is discarded
  // so an in-flight conversion of stale content can't overwrite a newer
  // one (e.g. on agent switch).
  const [historyHtml, setHistoryHtml] = useState<string>("");
  const ansiWorkerRef = useRef<Worker | null>(null);
  const ansiRequestSeqRef = useRef(0);
  const ansiLatestRequestIdRef = useRef(0);
  useEffect(() => {
    if (typeof Worker === "undefined") return; // jsdom / SSR fallback
    const worker = new Worker(new URL("@/lib/ansi-worker.ts", import.meta.url), {
      type: "module",
    });
    ansiWorkerRef.current = worker;
    worker.onmessage = (e: MessageEvent<{ id: number; html: string }>) => {
      if (e.data.id !== ansiLatestRequestIdRef.current) return;
      setHistoryHtml(e.data.html);
    };
    return () => {
      worker.terminate();
      ansiWorkerRef.current = null;
    };
  }, []);
  useEffect(() => {
    if (!historyCap.content) {
      ansiLatestRequestIdRef.current = ++ansiRequestSeqRef.current;
      setHistoryHtml("");
      return;
    }
    const content = shrinkContentToWidth(historyCap.content, cols);
    const worker = ansiWorkerRef.current;
    if (worker) {
      const id = ++ansiRequestSeqRef.current;
      ansiLatestRequestIdRef.current = id;
      worker.postMessage({ id, content });
    } else {
      // Fallback when Web Worker is unavailable (jsdom in tests). Runs
      // synchronously on the main thread; for production this branch
      // should not be hit.
      setHistoryHtml(ansi.ansi_to_html(content));
    }
  }, [historyCap, cols, ansi]);

  // Cursor row within the live region. The backend returns cursor_y as an
  // absolute row within the full capture output; since the tmux cursor is
  // always on the visible screen, subtracting `liveStartLine` yields the
  // row inside live.
  const liveCursor = useMemo(() => {
    if (!cursorPos) return null;
    const relY = cursorPos.y - liveStartLine;
    if (relY < 0) return null;
    return { x: cursorPos.x, y: relY };
  }, [cursorPos, liveStartLine]);

  // Live HTML: cheap path (AnsiUp on ~one screenful). Re-runs each tick and
  // when the cursor moves — but operates on a small string so it's fast.
  const liveHtml = useMemo(() => {
    const base = ansi.ansi_to_html(trimPreviewContent(live, cols));
    if (!liveCursor || !showCursor) return base;

    const lines = base.split("\n");
    if (lines.length === 0) return base;
    const clampedY = Math.min(liveCursor.y, lines.length - 1);

    const line = lines[clampedY];
    let col = 0;
    let inTag = false;
    let insertAt = line.length;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === "<") {
        inTag = true;
        continue;
      }
      if (line[i] === ">") {
        inTag = false;
        continue;
      }
      if (inTag) continue;
      if (col >= liveCursor.x) {
        insertAt = i;
        break;
      }
      let ch = line[i];
      if (ch === "&") {
        const semi = line.indexOf(";", i);
        if (semi > i && semi - i < 10) {
          const entity = line.slice(i, semi + 1);
          if (entity === "&amp;") ch = "&";
          else if (entity === "&lt;") ch = "<";
          else if (entity === "&gt;") ch = ">";
          else if (entity === "&quot;") ch = '"';
          i = semi;
        }
      }
      col += charColumns(ch.codePointAt(0) ?? 0);
    }

    const marker =
      '<span data-tmai-cursor="1" style="display:inline-block;width:0;height:0;vertical-align:top;overflow:hidden"></span>';
    lines[clampedY] = line.slice(0, insertAt) + marker + line.slice(insertAt);
    return lines.join("\n");
  }, [ansi, live, cols, liveCursor, showCursor]);
  const hasTranscript = transcriptRecords.length > 0;
  const hasContent = history.length > 0 || live.length > 0;

  // Cursor overlay position, read from the injected marker element
  const [cursorStyle, setCursorStyle] = useState<React.CSSProperties | null>(null);

  // Two refs, two writes: history gets its own innerHTML write that only
  // runs when historyHtml actually changed; live gets updated on every
  // tick. The old design wrote the concatenated blob on every tick, which
  // is what caused the input lag in long sessions.
  const historyRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef<HTMLDivElement>(null);
  const lastHistoryHtmlRef = useRef<string>("");
  const lastLiveHtmlRef = useRef<string>("");

  useEffect(() => {
    if (!historyRef.current) return;
    const sel = window.getSelection();
    const hasSelection = sel && sel.toString().length > 0;
    if (hasSelection) return;
    if (historyHtml === lastHistoryHtmlRef.current) return;
    lastHistoryHtmlRef.current = historyHtml;
    historyRef.current.innerHTML = DOMPurify.sanitize(historyHtml);
  }, [historyHtml]);

  useEffect(() => {
    const sel = window.getSelection();
    const hasSelection = !!(sel && sel.toString().length > 0);

    if (liveRef.current && !hasSelection && liveHtml !== lastLiveHtmlRef.current) {
      lastLiveHtmlRef.current = liveHtml;
      liveRef.current.innerHTML = DOMPurify.sanitize(liveHtml, {
        ADD_ATTR: ["data-tmai-cursor"],
      });
    }
    // Guard auto-scroll against active text selection: jumping the viewport
    // while the user is dragging to select text destroys the selection anchor.
    if (autoScroll && !hasSelection) {
      bottomRef.current?.scrollIntoView({ behavior: "instant" });
    }

    // Cursor marker lives inside liveRef; offsetTop is relative to the
    // nearest positioned ancestor (.ansi-preview), so it correctly accounts
    // for the history block above.
    if (!liveCursor || !liveRef.current) {
      setCursorStyle(null);
      return;
    }
    const marker = liveRef.current.querySelector("[data-tmai-cursor]") as HTMLElement | null;
    const charSpan = measureRef.current;
    if (!marker || !charSpan) {
      setCursorStyle(null);
      return;
    }
    const charW = charSpan.getBoundingClientRect().width;
    if (charW <= 0) {
      setCursorStyle(null);
      return;
    }
    // Measure the actual rendered line height rather than hardcoding font
    // metrics; the span carries the same font stack as the preview content.
    const lineH = charSpan.getBoundingClientRect().height || 13 * 1.35;
    setCursorStyle({
      left: `${marker.offsetLeft}px`,
      top: `${marker.offsetTop}px`,
      width: `${charW}px`,
      height: `${lineH}px`,
    });
  }, [liveHtml, autoScroll, liveCursor]);

  return (
    <div
      ref={containerRef}
      className={`relative flex flex-1 flex-col overflow-hidden bg-[#0c0c0c] outline-none ${
        focused && hasDomFocus ? "ring-1 ring-cyan-500/30 ring-inset" : ""
      }`}
    >
      <div
        role="log"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable log needs focus for keyboard scrolling
        tabIndex={0}
        ref={scrollContainerRef}
        onScroll={handleScroll}
        onMouseDown={() => {
          if (focused) {
            // Switch to select mode so keystrokes aren't sent while the user
            // drags. On mouseup we cancel this if no text was actually selected.
            enterSelectMode();
            pendingSelectRef.current = true;
          }
        }}
        onMouseUp={() => {
          const sel = window.getSelection();
          const hasSelection = !!(sel && sel.toString().length > 0);
          if (pendingSelectRef.current) {
            // mousedown came from input mode — only stay in select mode if the
            // user actually dragged out a selection; a plain click returns to
            // input mode so the user isn't unexpectedly locked out of typing.
            pendingSelectRef.current = false;
            if (!hasSelection) enterInputMode();
            return;
          }
          // In select mode (via button) or re-focusing from another panel:
          // a click with no selection returns to input mode.
          if (!focused || !hasDomFocus) {
            if (!hasSelection) enterInputMode();
          }
        }}
        className={`flex-1 overflow-y-auto p-3 text-[13px] leading-[1.35] ${
          !focused ? "ring-2 ring-amber-500/40 ring-inset" : ""
        }`}
      >
        {/* Hidden char-width measurement probe (same font as preview) */}
        <span
          ref={measureRef}
          aria-hidden="true"
          className="pointer-events-none absolute -left-[9999px] whitespace-pre text-[13px]"
          style={{
            fontFamily: MONO_FONT_STACK,
          }}
        >
          X
        </span>
        {/* Transcript tab — JSONL records via per-record react-markdown.
            Only mounted while activeTab === "transcript", so the Live tab
            never pays the rendering cost in long conversations. */}
        {activeTab === "transcript" &&
          (hasTranscript ? (
            <div className="select-text">
              <TranscriptView records={transcriptRecords} />
            </div>
          ) : (
            <div className="py-4 text-sm text-zinc-600">No transcript records yet</div>
          ))}
        {/* Live tab — always mounted so historyRef / liveRef survive tab
            switches. Without this, switching to Transcript and back would
            unmount the refs and the next innerHTML write only happens on
            the next poll tick (visible delay). The display toggle is cheap
            because the underlying DOM is preserved. */}
        <div style={{ display: activeTab === "live" ? undefined : "none" }}>
          {hasContent ? (
            /* Capture-pane output split into scrollback history (rendered
               once, cached) and live visible region (re-rendered each tick). */
            <div
              className="ansi-preview relative m-0 cursor-text select-text whitespace-pre-wrap break-words"
              style={{
                fontFamily: MONO_FONT_STACK,
              }}
            >
              {historyCap.dropped > 0 && (
                <div className="text-zinc-600 text-[10px] italic pb-1 select-none">
                  {`… ${historyCap.dropped.toLocaleString()} earlier line${
                    historyCap.dropped === 1 ? "" : "s"
                  } hidden (showing last ${MAX_HISTORY_LINES.toLocaleString()})`}
                </div>
              )}
              <div ref={historyRef} />
              <div ref={liveRef} />
              {cursorStyle && focused && hasDomFocus && showCursor && (
                <div
                  className="pointer-events-none absolute animate-pulse bg-cyan-400/70"
                  style={cursorStyle}
                  aria-hidden="true"
                />
              )}
            </div>
          ) : (
            <span className="text-zinc-600">Waiting for output...</span>
          )}
        </div>
        <div ref={bottomRef} />
      </div>

      {/* Hidden IME input — outside scroll container to avoid interfering with text selection */}
      <input
        ref={inputRef}
        type="text"
        className="pointer-events-none absolute h-px w-px overflow-hidden border-0 p-0 opacity-0"
        style={{ bottom: "2rem", left: "0.75rem", userSelect: "none" }}
        onKeyDown={handleKeyDown}
        onInput={handleInput}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={(e) => {
          setComposing(false);
          const value = e.currentTarget.value;
          if (value) {
            sendPassthrough({ chars: value });
            e.currentTarget.value = "";
          }
          // Re-sync preview once IME is done — sendPassthrough's own
          // fetchPreview scheduling covers the non-empty case, but for
          // the rare empty-confirm branch we explicitly catch up here.
          composingRef.current = false;
        }}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        tabIndex={-1}
      />

      {/* Incoming-prompt banner — shown briefly when a new send_prompt item
          arrives, keeping it isolated from the conversation input (#9). */}
      {incomingPrompt && (
        <div className="mx-3 mb-1 flex items-center gap-1.5 rounded border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-400">
          <span className="shrink-0">⚠ Incoming notification:</span>
          <span className="truncate text-amber-300">{incomingPrompt}</span>
        </div>
      )}

      {/* Footer status bar */}
      <div className="flex items-center gap-2 border-t border-white/5 px-3 py-1.5">
        {/* View tabs — Live (capture-pane, light) / Transcript (JSONL, heavy) */}
        <div className="inline-flex rounded bg-white/5 p-0.5">
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setActiveTab("live")}
            className={`touch-target-sm rounded px-2 py-0.5 text-xs transition-colors ${
              activeTab === "live"
                ? "bg-cyan-500/20 text-cyan-400"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
            title="Live capture-pane (ANSI, lightweight)"
          >
            Live
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setActiveTab("transcript")}
            className={`touch-target-sm rounded px-2 py-0.5 text-xs transition-colors ${
              activeTab === "transcript"
                ? "bg-cyan-500/20 text-cyan-400"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
            title="JSONL transcript (heavier; loaded on demand)"
          >
            Transcript
          </button>
        </div>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={focused ? enterSelectMode : enterInputMode}
          className={`touch-target-sm rounded px-2 py-1 text-xs transition-colors ${
            focused ? "bg-cyan-500/20 text-cyan-400" : "bg-amber-500/20 text-amber-400"
          }`}
          title={
            focused
              ? "Input mode — keystrokes sent to agent (click for select mode)"
              : "Select mode — click to copy text (click for input mode)"
          }
        >
          {focused ? "⌨ Input" : "📋 Select"}
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setAutoScroll((v) => !v)}
          className={`touch-target-sm rounded px-2 py-1 text-xs transition-colors ${
            autoScroll
              ? "bg-cyan-500/15 text-cyan-400"
              : "bg-white/5 text-zinc-600 hover:text-zinc-400"
          }`}
          title={autoScroll ? "Auto-scroll: ON" : "Auto-scroll: OFF"}
        >
          {autoScroll ? "⇩ Auto" : "⇩ Off"}
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setShowCursor((v) => !v)}
          className={`touch-target-sm rounded px-2 py-1 text-xs transition-colors ${
            showCursor
              ? "bg-cyan-500/15 text-cyan-400"
              : "bg-white/5 text-zinc-600 hover:text-zinc-400"
          }`}
          title={showCursor ? "Cursor: ON" : "Cursor: OFF"}
        >
          {showCursor ? "▮ Cursor" : "▯ Cursor"}
        </button>
        <div className="relative">
          <QueueBadge
            count={queueItems.length}
            onClick={() => setQueueOpen((v) => !v)}
            icon="✉"
            title={`${queueItems.length} prompt${queueItems.length !== 1 ? "s" : ""} queued — click to view`}
          />
          <QueuePopover
            items={queueItems}
            isOpen={queueOpen && queueItems.length > 0}
            onClose={() => setQueueOpen(false)}
            onCancel={cancelQueueItem}
            title="Queued Prompts"
            renderItem={(item) => (
              <div>
                <p className="truncate text-[11px] text-zinc-200" title={item.prompt}>
                  {item.prompt}
                </p>
                <p className="mt-0.5 text-[10px] text-zinc-500">
                  {item.origin && <span className="mr-2">{originLabel(item.origin)}</span>}
                  {new Date(item.queued_at).toLocaleTimeString()}
                </p>
              </div>
            )}
          />
        </div>
        <div className="flex-1" />
        <span className="hidden text-[10px] text-zinc-600 sm:block">
          {focused ? "click to select" : "Enter or click ⌨ to input"}
        </span>
      </div>
    </div>
  );
}
