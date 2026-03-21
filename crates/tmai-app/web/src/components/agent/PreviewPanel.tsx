import { useState, useEffect, useRef, useMemo } from "react";
import { api } from "@/lib/api";
import { AnsiUp } from "ansi_up";

interface PreviewPanelProps {
  agentId: string;
}

// Displays capture-pane output for agents without a PTY session
// (e.g., tmux-spawned agents). Supports ANSI colors. Polls for updates.
export function PreviewPanel({ agentId }: PreviewPanelProps) {
  const [content, setContent] = useState<string>("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const ansi = useMemo(() => {
    const a = new AnsiUp();
    a.use_classes = true;
    return a;
  }, []);

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
    const interval = setInterval(fetchPreview, 2000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [agentId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [content]);

  const html = useMemo(() => ansi.ansi_to_html(content), [ansi, content]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-[#0c0c0c]">
      <div className="flex-1 overflow-y-auto p-3 font-mono text-[13px] leading-[1.35]">
        {content ? (
          <pre
            className="ansi-preview m-0 whitespace-pre-wrap break-words"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <span className="text-zinc-600">Waiting for output...</span>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
