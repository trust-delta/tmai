import { useCallback, useEffect, useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";
import { AutoScrollToggleButton, ModeHint, ModeToggleButton } from "@/components/terminal/controls";
import { QueueBadge } from "@/components/ui/QueueBadge";
import { QueuePopover } from "@/components/ui/QueuePopover";
import { useAutoScrollPerAgent } from "@/hooks/useAutoScrollPerAgent";
import { useQueuedPrompts } from "@/hooks/useQueuedPrompts";
import { useTerminal } from "@/hooks/useTerminal";
import { api } from "@/lib/api";
import type { QueuedPrompt, TranscriptRecord } from "@/lib/api-http";
import { keyEventToBytes, textToBytes } from "@/lib/keys";
import type { ActionOrigin } from "@/types";
import { TranscriptView } from "./TranscriptView";

// xterm.js-backed PreviewPanel (#5 Phase 1, behind `tmai:preview-xterm`
// feature flag). Replaces the AnsiUp + Worker + innerHTML pipeline of
// `PreviewPanel.tsx` with a real terminal emulator. Phase 1 keeps the
// UX shape (Live / Transcript tabs, mode toggle, queue badge, IME via
// hidden input) so users can A/B against the legacy preview without
// re-learning anything; Phases 2-4 retire the legacy path and the
// AnsiUp dependency.

interface PreviewPanelXtermProps {
  agentId: string;
}

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

export function PreviewPanelXterm({ agentId }: PreviewPanelXtermProps) {
  const [activeTab, setActiveTab] = useState<"live" | "transcript">("live");
  const [transcriptRecords, setTranscriptRecords] = useState<TranscriptRecord[]>([]);
  const [focused, setFocused] = useState(true);
  const [hasDomFocus, setHasDomFocus] = useState(false);
  const [composing, setComposing] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [incomingPrompt, setIncomingPrompt] = useState<string | null>(null);
  const incomingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const composingRef = useRef(false);
  useEffect(() => {
    composingRef.current = composing;
  }, [composing]);

  const handleNewQueueItem = useCallback((item: QueuedPrompt) => {
    setIncomingPrompt(item.prompt);
    if (incomingTimerRef.current) clearTimeout(incomingTimerRef.current);
    incomingTimerRef.current = setTimeout(() => setIncomingPrompt(null), 5000);
  }, []);
  const { items: queueItems, cancel: cancelQueueItem } = useQueuedPrompts(
    agentId,
    handleNewQueueItem,
  );

  const [autoScroll, setAutoScroll] = useAutoScrollPerAgent(agentId);

  const containerRef = useRef<HTMLDivElement>(null);
  const xtermContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Tracks whether the current mousedown originated in input mode and
  // triggered a preemptive enterSelectMode(). On mouseup we cancel the
  // mode switch when no text was actually selected (plain click, no drag).
  const pendingSelectRef = useRef(false);

  // Mount xterm and stream the agent's PTY into it. Keys flow through
  // our hidden IME input (handleKeyDown / handleInput / composition),
  // not xterm's onData — xterm v5's IME handling still has rough edges
  // on the Live preview surface; Phase 2 evaluates moving fully to
  // xterm-native input.
  const { sendKeys } = useTerminal({
    agentId,
    containerRef: xtermContainerRef,
    autoScroll,
    keysHandledExternally: true,
  });

  // Track whether the panel container has DOM focus. Used to drive the
  // focus ring and to drop input-mode when focus leaves the panel.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onFocusIn = () => setHasDomFocus(true);
    const onFocusOut = (e: FocusEvent) => {
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

  const enterInputMode = useCallback(() => {
    setFocused(true);
  }, []);
  const enterSelectMode = useCallback(() => {
    setFocused(false);
  }, []);

  // Focus / blur the hidden IME input when mode flips.
  useEffect(() => {
    if (focused) {
      const timer = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
    inputRef.current?.blur();
  }, [focused]);

  // Reset transcript on agent switch — xterm itself is reset by
  // `useTerminal` via `onStatus("connecting")`, so the Live region
  // does not need an explicit clear here.
  // biome-ignore lint/correctness/useExhaustiveDependencies: agentId is the trigger
  useEffect(() => {
    setTranscriptRecords([]);
    setFocused(true);
    setHasDomFocus(true);
    setComposing(false);
  }, [agentId]);

  // Clear incoming-prompt banner on agent switch / unmount.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally clears on agent switch
  useEffect(() => {
    return () => {
      if (incomingTimerRef.current) clearTimeout(incomingTimerRef.current);
      setIncomingPrompt(null);
    };
  }, [agentId]);

  // Fetch transcript records (slower cadence — history changes less often).
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
      // transcript unavailable (no hook connection, etc.)
    }
  }, [agentId]);

  useEffect(() => {
    if (activeTab !== "transcript") return;
    fetchTranscript();
    const interval = setInterval(fetchTranscript, 3000);
    return () => clearInterval(interval);
  }, [fetchTranscript, activeTab]);

  // Special / control keys via the hidden input's keydown.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (composing) return;
      // Allow native copy when there is a text selection.
      if (e.ctrlKey && e.key === "c") {
        const sel = window.getSelection();
        if (sel && sel.toString().length > 0) return;
      }
      // Let the browser handle paste — pasted text reaches us via onInput.
      if (e.ctrlKey && e.key === "v") return;

      const bytes = keyEventToBytes(e.nativeEvent);
      if (bytes) {
        e.preventDefault();
        sendKeys(bytes.buffer);
      }
    },
    [composing, sendKeys],
  );

  // IME-confirmed text + paste arrive via the input event.
  const handleInput = useCallback(
    (e: React.FormEvent<HTMLInputElement>) => {
      const input = e.currentTarget;
      const value = input.value;
      if (value && !composing) {
        sendKeys(textToBytes(value).buffer);
        input.value = "";
      }
    },
    [composing, sendKeys],
  );

  const hasTranscript = transcriptRecords.length > 0;

  return (
    <div
      ref={containerRef}
      className={`relative flex flex-1 flex-col overflow-hidden bg-[#0c0c0c] outline-none ${
        focused && hasDomFocus ? "ring-1 ring-cyan-500/30 ring-inset" : ""
      }`}
    >
      {/* Live tab — xterm canvas. Stays mounted across tab toggles so
          the PTY stream isn't torn down when the user briefly opens
          Transcript. */}
      <div
        style={{ display: activeTab === "live" ? undefined : "none" }}
        className="flex-1 overflow-hidden"
      >
        {/* biome-ignore lint/a11y/noStaticElementInteractions: terminal container needs pointer events for selection mode */}
        <div
          ref={xtermContainerRef}
          className="h-full w-full p-1"
          onMouseDown={() => {
            if (focused) {
              // Drop input mode on drag-to-select. mouseup decides whether
              // to revert when no selection actually formed.
              enterSelectMode();
              pendingSelectRef.current = true;
            }
          }}
          onMouseUp={() => {
            const sel = window.getSelection();
            const hasSelection = !!(sel && sel.toString().length > 0);
            if (pendingSelectRef.current) {
              pendingSelectRef.current = false;
              if (!hasSelection) enterInputMode();
              return;
            }
            if (!focused || !hasDomFocus) {
              if (!hasSelection) enterInputMode();
            }
          }}
        />
      </div>

      {/* Transcript tab — JSONL records. Mounted only while active to
          keep per-record react-markdown out of the Live monitoring
          path. */}
      {activeTab === "transcript" && (
        <div className="flex-1 overflow-y-auto p-3 text-[13px]">
          {hasTranscript ? (
            <div className="select-text">
              <TranscriptView records={transcriptRecords} />
            </div>
          ) : (
            <div className="py-4 text-sm text-zinc-600">No transcript records yet</div>
          )}
        </div>
      )}

      {/* Hidden IME input — sits outside the xterm container so it does
          not interfere with text selection. */}
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
            sendKeys(textToBytes(value).buffer);
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

      {incomingPrompt && (
        <div className="mx-3 mb-1 flex items-center gap-1.5 rounded border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-400">
          <span className="shrink-0">⚠ Incoming notification:</span>
          <span className="truncate text-amber-300">{incomingPrompt}</span>
        </div>
      )}

      <div className="flex items-center gap-2 border-t border-white/5 px-3 py-1.5">
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
            title="Live xterm preview"
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
        <ModeToggleButton
          inputMode={focused}
          onToggle={focused ? enterSelectMode : enterInputMode}
        />
        <AutoScrollToggleButton autoScroll={autoScroll} onToggle={() => setAutoScroll((v) => !v)} />
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
        <ModeHint inputMode={focused} />
      </div>
    </div>
  );
}
