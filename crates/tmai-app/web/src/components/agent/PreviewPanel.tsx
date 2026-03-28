import { AnsiUp } from "ansi_up";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";

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

// Box Drawing horizontal characters (U+2500–U+257F range commonly used for lines)
const HLINE_RE = /^[\u2500-\u257f]+$/;

// ANSI escape patterns (constructed via RegExp to avoid control-char lint)
const ESC = "\x1b";
const CSI_RE = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, "g");
const OSC_RE = new RegExp(`${ESC}\\][^\\x07${ESC}]*(?:\\x07|${ESC}\\\\)`, "g");
const LEAD_CSI_RE = new RegExp(`^(${ESC}\\[[0-9;?]*[ -/]*[@-~])*`);
const TRAIL_CSI_RE = new RegExp(`(${ESC}\\[[0-9;?]*[ -/]*[@-~])*$`);

// Trim trailing blank lines and truncate Box Drawing horizontal lines to fit container width
function trimPreviewContent(raw: string, cols: number): string {
  // Strip trailing blank lines (may contain ANSI escapes but no visible chars)
  const trimmed = raw.replace(/(\s*\n)*\s*$/, "");
  if (cols <= 0) return trimmed;

  return trimmed.replace(/^.*$/gm, (line) => {
    // Strip ANSI escapes to measure visible length
    const visible = line.replace(CSI_RE, "").replace(OSC_RE, "");
    if (HLINE_RE.test(visible) && visible.length > cols) {
      // Truncate: keep only `cols` visible chars while preserving leading ANSI
      const leadAnsi = line.match(LEAD_CSI_RE)?.[0] ?? "";
      const trailAnsi = line.match(TRAIL_CSI_RE)?.[0] ?? "";
      return leadAnsi + visible.slice(0, cols) + trailAnsi;
    }
    return line;
  });
}

// Interactive terminal preview with passthrough input.
// Renders capture-pane output with ANSI colors and forwards keystrokes
// to the agent's terminal. Passthrough is button-controlled.
// IME (Japanese, Chinese, etc.) is supported via a hidden input element.
export function PreviewPanel({ agentId }: PreviewPanelProps) {
  const [content, setContent] = useState<string>("");
  const [focused, setFocused] = useState(true);
  const [composing, setComposing] = useState(false);
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

  // Reset state when switching agents (autoScroll restored from per-agent map)
  useEffect(() => {
    setContent("");
    setFocused(true);
    setAutoScrollRaw(agentAutoScrollMap.get(agentId) ?? true);
    setComposing(false);
  }, [agentId]);

  // Switch to input mode (passthrough ON)
  const enterInputMode = useCallback(() => {
    setFocused(true);
  }, []);

  // Switch to select mode (passthrough OFF, text selection enabled)
  const enterSelectMode = useCallback(() => {
    setFocused(false);
  }, []);

  // Focus/blur the hidden input when mode changes
  useEffect(() => {
    if (focused) {
      const timer = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    } else {
      inputRef.current?.blur();
    }
  }, [focused]);

  // Polling interval: faster when focused for interactive feel
  const pollInterval = focused ? 500 : 2000;

  // Fetch preview content, shared between polling and post-keystroke refresh
  // Skips DOM update while user has an active text selection
  const fetchPreview = useCallback(async () => {
    try {
      const data = await api.getPreview(agentId);
      if (!data.content) return;
      const sel = window.getSelection();
      if (sel && sel.toString().length > 0) return;
      setContent(data.content);
    } catch {
      // Agent may not have content yet
    }
  }, [agentId]);

  useEffect(() => {
    fetchPreview();
    const interval = setInterval(fetchPreview, pollInterval);
    return () => clearInterval(interval);
  }, [fetchPreview, pollInterval]);

  // Send passthrough input then immediately refresh the preview
  const sendPassthrough = useCallback(
    (input: { chars?: string; key?: string }) => {
      api
        .passthrough(agentId, input)
        .then(() => {
          // Small delay for tmux to process, then fetch updated content
          setTimeout(fetchPreview, 30);
        })
        .catch(() => {});
    },
    [agentId, fetchPreview],
  );

  // Auto-scroll to bottom (toggleable, default on)

  // Scroll handler (reserved for future use, auto-scroll is button-controlled only)
  const handleScroll = useCallback(() => {}, []);

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

      // Esc: switch to select mode
      if (e.key === "Escape" && !e.ctrlKey) {
        enterSelectMode();
        return;
      }

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
    [composing, enterSelectMode, sendPassthrough],
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

  const html = useMemo(
    () => ansi.ansi_to_html(trimPreviewContent(content, cols)),
    [ansi, content, cols],
  );

  // Set innerHTML via ref to bypass React's DOM diffing, which destroys text selection.
  // Also handles auto-scroll after content update to ensure correct ordering.
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (contentRef.current) {
      const sel = window.getSelection();
      const hasSelection = sel && sel.toString().length > 0;
      if (!hasSelection) {
        contentRef.current.innerHTML = html;
      }
    }
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: "instant" });
    }
  }, [html, autoScroll]);

  return (
    <div
      ref={containerRef}
      className={`relative flex flex-1 flex-col overflow-hidden bg-[#0c0c0c] outline-none ${
        focused ? "ring-1 ring-cyan-500/30 ring-inset" : ""
      }`}
    >
      <div
        role="log"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable log needs focus for keyboard scrolling
        tabIndex={0}
        ref={scrollContainerRef}
        onScroll={handleScroll}
        onMouseDown={() => {
          if (focused) enterSelectMode();
        }}
        onMouseUp={() => {
          // If no text was selected (just a click), return to input mode
          if (!focused) {
            const sel = window.getSelection();
            if (!sel || sel.toString().length === 0) {
              enterInputMode();
            }
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
        {content ? (
          <div
            className="ansi-preview m-0 cursor-text select-text whitespace-pre-wrap break-words"
            style={{
              fontFamily: MONO_FONT_STACK,
            }}
          >
            <div ref={contentRef} />
          </div>
        ) : (
          <span className="text-zinc-600">Waiting for output...</span>
        )}
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
        }}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        tabIndex={-1}
      />

      {/* Footer status bar */}
      <div className="flex items-center gap-2 border-t border-white/5 px-3 py-1">
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={focused ? enterSelectMode : enterInputMode}
          className={`rounded px-1.5 py-0.5 text-[10px] transition-colors ${
            focused ? "bg-cyan-500/20 text-cyan-400" : "bg-amber-500/20 text-amber-400"
          }`}
          title={
            focused
              ? "Input mode — keystrokes sent to agent (click or Esc for select mode)"
              : "Select mode — click to copy text (click for input mode)"
          }
        >
          {focused ? "⌨ Input" : "📋 Select"}
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setAutoScroll((v) => !v)}
          className={`rounded px-1.5 py-0.5 text-[10px] transition-colors ${
            autoScroll
              ? "bg-cyan-500/15 text-cyan-400"
              : "bg-white/5 text-zinc-600 hover:text-zinc-400"
          }`}
          title={autoScroll ? "Auto-scroll: ON" : "Auto-scroll: OFF"}
        >
          {autoScroll ? "⇩ Auto" : "⇩ Off"}
        </button>
        <div className="flex-1" />
        <span className="text-[10px] text-zinc-600">
          {focused ? "Esc / click to select" : "click ⌨ to input"}
        </span>
      </div>
    </div>
  );
}
