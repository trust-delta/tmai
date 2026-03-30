import { AnsiUp } from "ansi_up";
import DOMPurify from "dompurify";
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

// Terminal column width of a character (full-width CJK = 2, others = 1).
// Matches wcwidth behavior for common Unicode ranges.
function charColumns(cp: number): number {
  if (
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
    (cp >= 0x2e80 && cp <= 0x303e) || // CJK Radicals, Kangxi, Ideographic
    (cp >= 0x3041 && cp <= 0x33bf) || // Hiragana, Katakana, Bopomofo, CJK compat
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK Unified Ideographs Extension A
    (cp >= 0x4e00 && cp <= 0xa4cf) || // CJK Unified Ideographs, Yi
    (cp >= 0xac00 && cp <= 0xd7af) || // Hangul Syllables
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK Compatibility Ideographs
    (cp >= 0xfe30 && cp <= 0xfe6f) || // CJK Compatibility Forms
    (cp >= 0xff01 && cp <= 0xff60) || // Fullwidth Forms
    (cp >= 0xffe0 && cp <= 0xffe6) || // Fullwidth Signs
    (cp >= 0x20000 && cp <= 0x2fffd) || // CJK Ext B-F
    (cp >= 0x30000 && cp <= 0x3fffd) // CJK Ext G+
  ) {
    return 2;
  }
  return 1;
}

// Consecutive Box Drawing horizontal characters (U+2500–U+257F runs of 4+)
const HLINE_RUN_RE = /[\u2500-\u257f]{4,}/g;

// ANSI escape patterns (constructed via RegExp to avoid control-char lint)
const ESC = "\x1b";
const CSI_RE = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, "g");
const OSC_RE = new RegExp(`${ESC}\\][^\\x07${ESC}]*(?:\\x07|${ESC}\\\\)`, "g");

// Shrink Box Drawing horizontal runs so the line fits within `cols` columns.
// Text portions are preserved; only the ──── runs get shortened.
function shrinkHorizontalRuns(visible: string, cols: number): string {
  if (visible.length <= cols) return visible;

  const excess = visible.length - cols;

  // Collect all runs
  const runs: { index: number; length: number }[] = [];
  HLINE_RUN_RE.lastIndex = 0;
  for (const m of visible.matchAll(HLINE_RUN_RE)) {
    if (m.index != null) runs.push({ index: m.index, length: m[0].length });
  }
  if (runs.length === 0) return visible;

  const totalRunChars = runs.reduce((s, r) => s + r.length, 0);
  if (totalRunChars <= excess) {
    // Even removing all runs isn't enough — just trim to cols
    return visible.slice(0, cols);
  }

  // Shrink each run proportionally to its share of the total run length
  const newLengths = runs.map((r) => {
    const shrink = Math.ceil((r.length / totalRunChars) * excess);
    return Math.max(1, r.length - shrink);
  });

  // Rebuild the string with shortened runs
  let result = "";
  let pos = 0;
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    result += visible.slice(pos, run.index);
    result += visible.slice(run.index, run.index + newLengths[i]);
    pos = run.index + run.length;
  }
  result += visible.slice(pos);
  return result;
}

// Trim trailing blank lines and shrink Box Drawing horizontal runs to fit container width
function trimPreviewContent(raw: string, cols: number): string {
  // Strip trailing blank lines (may contain ANSI escapes but no visible chars)
  const trimmed = raw.replace(/(\s*\n)*\s*$/, "");
  if (cols <= 0) return trimmed;

  return trimmed.replace(/^.*$/gm, (line) => {
    // Strip ANSI escapes to measure visible length
    const visible = line.replace(CSI_RE, "").replace(OSC_RE, "");
    if (visible.length <= cols) return line;
    // Only process lines that contain box-drawing runs
    if (!HLINE_RUN_RE.test(visible)) return line;
    HLINE_RUN_RE.lastIndex = 0;

    // Rebuild line: replace visible content with shrunk version, keep ANSI intact
    const shrunk = shrinkHorizontalRuns(visible, cols);
    // Re-attach leading/trailing ANSI sequences from original line
    const leadAnsi = line.match(new RegExp(`^(${ESC}\\[[0-9;?]*[ -/]*[@-~])*`))?.[0] ?? "";
    const trailAnsi = line.match(new RegExp(`(${ESC}\\[[0-9;?]*[ -/]*[@-~])*$`))?.[0] ?? "";
    return leadAnsi + shrunk + trailAnsi;
  });
}

// Interactive terminal preview with passthrough input.
// Renders capture-pane output with ANSI colors and forwards keystrokes
// to the agent's terminal. Passthrough is button-controlled.
// IME (Japanese, Chinese, etc.) is supported via a hidden input element.
// Cursor position from the backend (terminal cursor, 0-indexed)
interface CursorPos {
  x: number;
  y: number;
}

export function PreviewPanel({ agentId }: PreviewPanelProps) {
  const [content, setContent] = useState<string>("");
  const [cursorPos, setCursorPos] = useState<CursorPos | null>(null);
  const [showCursor, setShowCursor] = useState(true);
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

  // Load cursor visibility setting from server
  useEffect(() => {
    api
      .getPreviewSettings()
      .then((s) => setShowCursor(s.show_cursor))
      .catch(() => {});
  }, []);

  // Reset state when switching agents (autoScroll restored from per-agent map)
  useEffect(() => {
    setContent("");
    setCursorPos(null);
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
      if (data.cursor_x != null && data.cursor_y != null) {
        setCursorPos({ x: data.cursor_x, y: data.cursor_y });
      } else {
        setCursorPos(null);
      }
    } catch {
      // Agent may not have content yet
    }
  }, [agentId]);

  useEffect(() => {
    fetchPreview();
    const interval = setInterval(fetchPreview, pollInterval);
    return () => clearInterval(interval);
  }, [fetchPreview, pollInterval]);

  // Pending passthrough refresh timers (cleared on agent switch / unmount)
  const passthroughTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => {
    return () => {
      for (const t of passthroughTimers.current) clearTimeout(t);
      passthroughTimers.current = [];
    };
  }, [agentId]);

  // Send passthrough input then refresh preview with two-stage fetch
  // for responsive cursor tracking
  const sendPassthrough = useCallback(
    (input: { chars?: string; key?: string }) => {
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
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    setAutoScroll(atBottom);
  }, [setAutoScroll]);

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

  // Inject cursor marker into ANSI HTML at the cursor position.
  // Counts visible characters (skipping HTML tags/entities) to find the exact column.
  const htmlWithCursor = useMemo(() => {
    const base = ansi.ansi_to_html(trimPreviewContent(content, cols));
    if (!cursorPos || !showCursor) return base;

    const lines = base.split("\n");
    if (lines.length === 0) return base;
    // Clamp cursor_y to content bounds instead of giving up
    const clampedY = Math.min(cursorPos.y, lines.length - 1);

    const line = lines[clampedY];
    let col = 0; // column count (full-width chars = 2)
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
      if (col >= cursorPos.x) {
        insertAt = i;
        break;
      }
      // Skip HTML entities like &amp; (counts as 1 char)
      let ch = line[i];
      if (ch === "&") {
        const semi = line.indexOf(";", i);
        if (semi > i && semi - i < 10) {
          // Decode common entities to get the actual character
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
  }, [ansi, content, cols, cursorPos, showCursor]);
  const html = htmlWithCursor;

  // Cursor overlay position, read from the injected marker element
  const [cursorStyle, setCursorStyle] = useState<React.CSSProperties | null>(null);

  // Set innerHTML via ref to bypass React's DOM diffing, which destroys text selection.
  // Also handles auto-scroll after content update to ensure correct ordering.
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (contentRef.current) {
      const sel = window.getSelection();
      const hasSelection = sel && sel.toString().length > 0;
      if (!hasSelection) {
        contentRef.current.innerHTML = DOMPurify.sanitize(html, {
          ADD_ATTR: ["data-tmai-cursor"],
        });
      }
    }
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: "instant" });
    }

    // Read cursor position from the injected marker's offsetTop/offsetLeft
    if (!cursorPos || !contentRef.current) {
      setCursorStyle(null);
      return;
    }
    const marker = contentRef.current.querySelector("[data-tmai-cursor]") as HTMLElement | null;
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

    const lineH = 13 * 1.35;
    setCursorStyle({
      left: `${marker.offsetLeft}px`,
      top: `${marker.offsetTop}px`,
      width: `${charW}px`,
      height: `${lineH}px`,
    });
  }, [html, autoScroll, cursorPos]);

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
            className="ansi-preview relative m-0 cursor-text select-text whitespace-pre-wrap break-words"
            style={{
              fontFamily: MONO_FONT_STACK,
            }}
          >
            <div ref={contentRef} />
            {cursorStyle && focused && showCursor && (
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
          className={`rounded px-1.5 py-0.5 text-[10px] transition-colors ${
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
          className={`rounded px-1.5 py-0.5 text-[10px] transition-colors ${
            showCursor
              ? "bg-cyan-500/15 text-cyan-400"
              : "bg-white/5 text-zinc-600 hover:text-zinc-400"
          }`}
          title={showCursor ? "Cursor: ON" : "Cursor: OFF"}
        >
          {showCursor ? "▮ Cursor" : "▯ Cursor"}
        </button>
        <div className="flex-1" />
        <span className="text-[10px] text-zinc-600">
          {focused ? "click to select" : "click ⌨ to input"}
        </span>
      </div>
    </div>
  );
}
