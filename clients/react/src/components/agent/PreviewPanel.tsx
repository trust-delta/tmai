import { AnsiUp } from "ansi_up";
import DOMPurify from "dompurify";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { QueueBadge } from "@/components/ui/QueueBadge";
import { QueuePopover } from "@/components/ui/QueuePopover";
import { useAgentTerminalStream } from "@/hooks/useAgentTerminalStream";
import { useQueuedPrompts } from "@/hooks/useQueuedPrompts";
import { api } from "@/lib/api";
import type { QueuedPrompt, TranscriptRecord } from "@/lib/api-http";
import { keyEventToBytes, textToBytes } from "@/lib/keys";
import type { ActionOrigin } from "@/types";
import { capHistoryLines, shrinkContentToWidth, trimPreviewContent } from "./preview-content";

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

// Interactive terminal preview wired to the rev3 terminal-plane
// WebSocket (`subscribe-terminal` + `keys`). Renders ANSI bytes pushed by
// the PTY-server and forwards keystrokes via `keyEventToBytes`.
// IME (Japanese, Chinese, etc.) is supported via a hidden input element.

import { TranscriptView } from "./TranscriptView";

export function PreviewPanel({ agentId }: PreviewPanelProps) {
  // `history` is reserved for a future Phase 4 wire frame that surfaces
  // PTY-server scrollback as a separate region; under the current WS-only
  // path it stays empty and the entire stream lands in `live`.
  const [history, setHistory] = useState<string>("");
  const [live, setLive] = useState<string>("");
  const [transcriptRecords, setTranscriptRecords] = useState<TranscriptRecord[]>([]);
  // "live" = streamed terminal output (cheap, default). "transcript" =
  // JSONL records (heavy: per-record react-markdown). Splitting them into
  // tabs keeps the common monitoring path light; the transcript polling
  // only runs when the user actively opens it.
  const [activeTab, setActiveTab] = useState<"live" | "transcript">("live");
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
  // Mirror `composing` into a ref so the WS data callback can read the
  // current composition state without being re-created on every flip.
  const composingRef = useRef(false);
  useEffect(() => {
    composingRef.current = composing;
  }, [composing]);

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

  // Rev3 terminal-plane (#174 Phase 3b-3). ANSI bytes arrive on the
  // stream WebSocket and append into `liveBufferRef`; key events route
  // through `sendKeys` (raw bytes via the `keys` WS) rather than the old
  // `passthrough` HTTP path.
  //
  // The buffer is capped at ~256 KB to keep AnsiUp / DOMPurify /
  // innerHTML bounded — long-running agents emit megabytes of ANSI per
  // hour and an unbounded `setLive(...)` would freeze the panel. Slicing
  // at byte level can split a UTF-8 sequence or an ANSI escape; the
  // worst case is a single mojibake or color glyph at the seam, which
  // is acceptable until Phase 4 replaces this with xterm.js.
  const LIVE_BUFFER_BYTE_CAP = 256_000;
  const liveBufferRef = useRef<string>("");
  const onWsData = useCallback((bytes: Uint8Array): void => {
    if (composingRef.current) return;
    const chunk = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    let next = liveBufferRef.current + chunk;
    if (next.length > LIVE_BUFFER_BYTE_CAP) {
      next = next.slice(-LIVE_BUFFER_BYTE_CAP);
    }
    liveBufferRef.current = next;
    setLive(next);
  }, []);
  const { sendKeys: wsSendKeys } = useAgentTerminalStream({
    agentId,
    onData: onWsData,
  });

  // Reset state when switching agents (autoScroll restored from per-agent map)
  useEffect(() => {
    setHistory("");
    setLive("");
    setTranscriptRecords([]);
    setFocused(true);
    setHasDomFocus(true);
    setAutoScrollRaw(agentAutoScrollMap.get(agentId) ?? true);
    setComposing(false);
    lastHistoryHtmlRef.current = "";
    lastLiveHtmlRef.current = "";
  }, [agentId]);

  // Switch to input mode — keystrokes flow to the agent over the keys WS.
  const enterInputMode = useCallback(() => {
    setFocused(true);
  }, []);

  // Switch to select mode — input ignored so the user can drag-select text.
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

  // Reset preview state on agent switch so the previous agent's
  // streamed output / transcript don't flash on screen until the new
  // agent's WS subscription delivers its first frame.
  // biome-ignore lint/correctness/useExhaustiveDependencies: agentId is the trigger; body uses only setters/refs
  useEffect(() => {
    setHistory("");
    setLive("");
    setTranscriptRecords([]);
    // Drop the WS append buffer too — the new agent has its own stream
    // and `onWsData` will start filling this from zero.
    liveBufferRef.current = "";
    // Suppress the synthetic onScroll the browser fires when the
    // history block re-rendering after the switch changes scrollHeight
    // — without this, autoScroll would flip off without any user
    // gesture, exactly like the tab-switch case.
    skipNextScrollEventRef.current = true;
  }, [agentId]);

  // Clear incoming-prompt indicator on agent switch and on unmount
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally clear on agent switch
  useEffect(() => {
    return () => {
      if (incomingTimerRef.current) clearTimeout(incomingTimerRef.current);
      setIncomingPrompt(null);
    };
  }, [agentId]);

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

  // Handle special keys (non-IME) via the hidden input's keydown.
  // Sends raw bytes through the rev3 keys WebSocket.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      // Don't intercept during IME composition
      if (composing) return;

      // Allow Ctrl+C to copy when there is a text selection
      if (e.ctrlKey && e.key === "c") {
        const sel = window.getSelection();
        if (sel && sel.toString().length > 0) return; // let browser handle copy
      }

      // Allow Ctrl+V to paste via browser — the pasted text arrives
      // through the hidden input's onInput handler and lands on the keys
      // WebSocket from there.
      if (e.ctrlKey && e.key === "v") return;

      const bytes = keyEventToBytes(e.nativeEvent);
      if (bytes) {
        e.preventDefault();
        wsSendKeys(bytes.buffer);
      }
    },
    [composing, wsSendKeys],
  );

  // Handle IME confirmed text via input event
  const handleInput = useCallback(
    (e: React.FormEvent<HTMLInputElement>) => {
      const input = e.currentTarget;
      const value = input.value;
      if (value && !composing) {
        // IME confirmed or direct paste — send the full text bytes
        // through the keys WebSocket.
        wsSendKeys(textToBytes(value).buffer);
        input.value = "";
      }
    },
    [composing, wsSendKeys],
  );

  // History HTML: reserved for a future Phase 4 wire frame that surfaces
  // PTY-server scrollback as a separate region. Under the current WS-only
  // path `history` stays empty, so the worker just receives "" — the
  // worker plumbing is left in place to keep the eventual scrollback
  // upgrade a single state-write away.
  //
  // We still cap to MAX_HISTORY_LINES so the worker pipeline cannot blow
  // up if scrollback ever lands.
  const deferredHistory = useDeferredValue(history);
  const historyCap = useMemo(
    () => capHistoryLines(deferredHistory, MAX_HISTORY_LINES),
    [deferredHistory],
  );

  // History HTML conversion happens off the main thread via a Web Worker
  // (lib/ansi-worker.ts). The worker stays even though history is empty
  // today — this keeps Phase 4's scrollback rollout from re-introducing
  // the old "first paint freezes for several seconds" regression.
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

  // Live HTML: cheap path (AnsiUp on ~one screenful). Re-runs whenever
  // the WS push appends bytes — operates on a bounded string so it stays
  // fast even for chatty agents.
  const liveHtml = useMemo(
    () => ansi.ansi_to_html(trimPreviewContent(live, cols)),
    [ansi, live, cols],
  );
  const hasTranscript = transcriptRecords.length > 0;
  const hasContent = history.length > 0 || live.length > 0;

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
      liveRef.current.innerHTML = DOMPurify.sanitize(liveHtml);
    }
    // Guard auto-scroll against active text selection: jumping the viewport
    // while the user is dragging to select text destroys the selection anchor.
    if (autoScroll && !hasSelection) {
      bottomRef.current?.scrollIntoView({ behavior: "instant" });
    }
  }, [liveHtml, autoScroll]);

  // Pin to bottom when the History HTML lands too — for an idle agent
  // the Live region barely changes, so the liveHtml-keyed scroll above
  // would never fire and the panel would open scrolled to the top of a
  // long scrollback. `historyHtml` is empty under the current WS-only
  // path; this effect re-fires once Phase 4's scrollback frame starts
  // populating it, which is why it stays in the dep list.
  // biome-ignore lint/correctness/useExhaustiveDependencies: historyHtml is the trigger; body only reads autoScroll
  useEffect(() => {
    if (!autoScroll) return;
    if (window.getSelection()?.toString().length) return;
    const id = requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: "instant" });
    });
    return () => cancelAnimationFrame(id);
  }, [historyHtml, autoScroll]);

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
            wsSendKeys(textToBytes(value).buffer);
            e.currentTarget.value = "";
          }
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
