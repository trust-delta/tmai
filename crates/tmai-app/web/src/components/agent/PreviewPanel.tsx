import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { api } from "@/lib/api";
import { AnsiUp } from "ansi_up";

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

// Interactive terminal preview with passthrough input.
// Renders capture-pane output with ANSI colors and forwards keystrokes
// to the agent's terminal. Click to focus, Esc to blur.
// IME (Japanese, Chinese, etc.) is supported via a hidden input element.
export function PreviewPanel({ agentId }: PreviewPanelProps) {
  const [content, setContent] = useState<string>("");
  const [focused, setFocused] = useState(true);
  const [composing, setComposing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const ansi = useMemo(() => {
    const a = new AnsiUp();
    a.use_classes = true;
    return a;
  }, []);

  // Focus the hidden input when agent is selected or panel gains focus.
  // Skip if the user has an active text selection (to avoid stealing focus
  // during copy/select operations).
  const focusInput = useCallback(() => {
    const sel = window.getSelection();
    if (sel && sel.toString().length > 0) return;
    setFocused(true);
    // Delay to ensure the hidden input is rendered
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  // Auto-focus on mount (agent selected from sidebar)
  useEffect(() => {
    focusInput();
  }, [agentId, focusInput]);

  // Polling interval: faster when focused for interactive feel
  const pollInterval = focused ? 500 : 2000;

  // Fetch preview content, shared between polling and post-keystroke refresh
  const fetchPreview = useCallback(async () => {
    try {
      const data = await api.getPreview(agentId);
      if (data.content) {
        setContent(data.content);
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
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // When user scrolls up, disable auto-scroll; when at bottom, re-enable
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    if (atBottom && !autoScroll) {
      setAutoScroll(true);
    }
  }, [autoScroll]);

  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: "instant" });
    }
  }, [content, autoScroll]);

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

      // Esc: blur the panel
      if (e.key === "Escape" && !e.ctrlKey) {
        setFocused(false);
        inputRef.current?.blur();
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
    [agentId, composing],
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
    [agentId, composing],
  );

  const html = useMemo(() => ansi.ansi_to_html(content), [ansi, content]);

  return (
    <div
      ref={containerRef}
      onClick={focusInput}
      className={`relative flex flex-1 flex-col overflow-hidden bg-[#0c0c0c] outline-none ${
        focused ? "ring-1 ring-cyan-500/30 ring-inset" : ""
      }`}
    >
      {/* IME input — positioned at bottom-left so the candidate window appears there */}
      {focused && (
        <input
          ref={inputRef}
          type="text"
          className="absolute bottom-6 left-3 w-px bg-transparent text-transparent caret-transparent outline-none"
          style={{ fontSize: "13px", lineHeight: "1.35" }}
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
          onBlur={() => setFocused(false)}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
        />
      )}

      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-3 text-[13px] leading-[1.35]"
      >
        {content ? (
          <pre
            className="ansi-preview m-0 cursor-text select-text whitespace-pre-wrap break-words"
            style={{
              fontFamily:
                "'JetBrainsMono Nerd Font', 'JetBrainsMono NF', " +
                "'CaskaydiaCove Nerd Font', 'CaskaydiaCove NF', " +
                "'FiraCode Nerd Font', 'FiraCode NF', " +
                "'MesloLGS NF', 'Hack Nerd Font', " +
                "'JetBrains Mono', 'Cascadia Code', 'Fira Code', " +
                "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, " +
                "'Liberation Mono', 'Courier New', " +
                "'Symbols Nerd Font Mono', monospace",
            }}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <span className="text-zinc-600">Waiting for output...</span>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Footer: auto-scroll toggle + focus hint */}
      <div className="flex items-center border-t border-white/5 px-3 py-1">
        <button
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
        <div className="flex-1 text-center text-[11px]">
          {focused ? (
            <span className="text-cyan-500/60">PASSTHROUGH · Esc to unfocus</span>
          ) : content ? (
            <span className="text-zinc-600">Click to interact</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
