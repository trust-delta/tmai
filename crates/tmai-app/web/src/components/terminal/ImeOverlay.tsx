import { useState, useRef, useEffect, useCallback } from "react";

interface ImeOverlayProps {
  onSubmit: (text: string) => void;
  onClose: () => void;
}

// Floating input overlay for Japanese text entry via clipboard paste.
// Workaround for WebKitGTK IME limitation on WSL2/Linux.
// Usage: type Japanese in any Windows app → copy → Ctrl+V here → Enter to send.
export function ImeOverlay({ onSubmit, onClose }: ImeOverlayProps) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Read clipboard and send directly to PTY
  const handlePasteSend = useCallback(async () => {
    try {
      const clipText = await navigator.clipboard.readText();
      if (clipText) {
        onSubmit(clipText + "\n");
      }
    } catch {
      // Clipboard API may fail — user can still paste manually
    }
  }, [onSubmit]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!text) return;
      const payload = e.shiftKey ? text : text + "\n";
      onSubmit(payload);
      setText("");
    }
  };

  return (
    <div className="glass absolute inset-x-0 bottom-0 z-10 border-0 border-t border-white/5 p-3">
      <div className="flex items-start gap-2">
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          placeholder="Ctrl+V でペーストして Enter で送信"
          className="flex-1 resize-none rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-cyan-500/30 focus:outline-none"
        />
        <div className="flex flex-col gap-1">
          <button
            onClick={() => {
              if (text) {
                onSubmit(text + "\n");
                setText("");
              }
            }}
            disabled={!text}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
          >
            Send
          </button>
          <button
            onClick={handlePasteSend}
            className="rounded-md bg-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-600"
            title="クリップボードの内容を直接送信"
          >
            Paste+Send
          </button>
          <button
            onClick={onClose}
            className="rounded-md bg-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-600"
          >
            Close
          </button>
        </div>
      </div>
      <p className="mt-1.5 text-xs text-zinc-600">
        Ctrl+V → Enter: 送信+改行 / Paste+Send: クリップボードを直接送信 / Esc:
        閉じる
      </p>
    </div>
  );
}
