import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { api } from "@/lib/api";
import { AnsiUp } from "ansi_up";

interface PreviewPanelProps {
  agentId: string;
}

// Map browser KeyboardEvent to tmux key name for special keys
function toTmuxKey(e: KeyboardEvent): string | null {
  if (e.ctrlKey) {
    // Ctrl+C, Ctrl+D, etc.
    if (e.key.length === 1) return `C-${e.key.toLowerCase()}`;
    if (e.key === "Enter") return "C-m";
  }
  switch (e.key) {
    case "Enter":
      return "Enter";
    case "Escape":
      return "Escape";
    case "Backspace":
      return "BSpace";
    case "Tab":
      return "Tab";
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
export function PreviewPanel({ agentId }: PreviewPanelProps) {
  const [content, setContent] = useState<string>("");
  const [focused, setFocused] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const ansi = useMemo(() => {
    const a = new AnsiUp();
    a.use_classes = true;
    return a;
  }, []);

  // Auto-focus on mount (agent selected from sidebar)
  useEffect(() => {
    containerRef.current?.focus();
  }, [agentId]);

  // Polling interval: faster when focused for interactive feel
  const pollInterval = focused ? 500 : 2000;

  useEffect(() => {
    let cancelled = false;

    const fetchPreview = async () => {
      try {
        const data = await api.getPreview(agentId);
        if (!cancelled && data.content) {
          setContent(data.content);
        }
      } catch {
        // Agent may not have content yet
      }
    };

    fetchPreview();
    const interval = setInterval(fetchPreview, pollInterval);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [agentId, pollInterval]);

  // Auto-scroll to bottom when content changes
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [content]);

  // Handle keyboard passthrough
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!focused) return;

      // Esc: blur the panel instead of sending to agent
      if (e.key === "Escape" && !e.ctrlKey) {
        setFocused(false);
        containerRef.current?.blur();
        return;
      }

      // Prevent browser defaults for keys we handle
      e.preventDefault();
      e.stopPropagation();

      const tmuxKey = toTmuxKey(e.nativeEvent);
      if (tmuxKey) {
        // Special key → send as tmux key name
        api.passthrough(agentId, { key: tmuxKey }).catch(() => {});
      } else if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        // Regular character → send as literal
        api.passthrough(agentId, { chars: e.key }).catch(() => {});
      }
    },
    [agentId, focused],
  );

  const html = useMemo(() => ansi.ansi_to_html(content), [ansi, content]);

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onKeyDown={handleKeyDown}
      onClick={() => containerRef.current?.focus()}
      className={`flex flex-1 flex-col overflow-hidden bg-[#0c0c0c] outline-none ${
        focused ? "ring-1 ring-cyan-500/30 ring-inset" : ""
      }`}
    >
      <div className="flex-1 overflow-y-auto p-3 font-mono text-[13px] leading-[1.35]">
        {content ? (
          <pre
            className="ansi-preview m-0 cursor-text whitespace-pre-wrap break-words"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <span className="text-zinc-600">Waiting for output...</span>
        )}
        <div ref={bottomRef} />
      </div>
      {/* Focus hint */}
      {!focused && content && (
        <div className="border-t border-white/5 px-3 py-1 text-center text-[11px] text-zinc-600">
          Click to interact · Keystrokes will be sent to the agent
        </div>
      )}
      {focused && (
        <div className="border-t border-cyan-500/20 px-3 py-1 text-center text-[11px] text-cyan-500/60">
          PASSTHROUGH · Esc to unfocus
        </div>
      )}
    </div>
  );
}
