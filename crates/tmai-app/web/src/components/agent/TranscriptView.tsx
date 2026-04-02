import { memo, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { TranscriptRecord } from "@/lib/api";

interface TranscriptViewProps {
  records: TranscriptRecord[];
}

// Shared prose class names for markdown rendering (matches MarkdownPanel.tsx)
const PROSE_CLASSES = `prose prose-invert prose-sm max-w-none
  prose-headings:text-zinc-100 prose-headings:font-semibold
  prose-p:text-zinc-300 prose-p:leading-relaxed prose-p:my-1
  prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline
  prose-strong:text-zinc-200
  prose-code:text-cyan-400 prose-code:bg-white/5 prose-code:rounded prose-code:px-1 prose-code:py-0.5 prose-code:text-xs prose-code:before:content-none prose-code:after:content-none
  prose-pre:bg-zinc-900/50 prose-pre:border prose-pre:border-white/5 prose-pre:rounded-lg prose-pre:my-1
  prose-li:text-zinc-300 prose-li:my-0
  prose-ul:my-1 prose-ol:my-1
  prose-th:text-zinc-300 prose-th:border-white/10
  prose-td:text-zinc-400 prose-td:border-white/10
  prose-hr:border-white/10
  prose-blockquote:border-blue-500/30 prose-blockquote:text-zinc-400`;

// Tool name color mapping
const TOOL_COLORS: Record<string, string> = {
  Bash: "text-amber-400",
  Read: "text-cyan-400",
  Edit: "text-fuchsia-400",
  Write: "text-fuchsia-400",
  Grep: "text-teal-400",
  Glob: "text-teal-400",
  Agent: "text-violet-400",
};

// Get color class for a tool name
function toolColor(name: string): string {
  return TOOL_COLORS[name] ?? "text-amber-400";
}

// Truncate a string at a max length
function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}...` : s;
}

// Render a user message record
const UserRecord = memo(function UserRecord({
  record,
}: {
  record: Extract<TranscriptRecord, { type: "user" }>;
}) {
  const firstLine = record.text.split("\n")[0] ?? record.text;
  return (
    <div className="py-1">
      <span className="text-cyan-400 font-medium">{"▶ "}</span>
      <span className="text-zinc-300">{truncate(firstLine, 200)}</span>
    </div>
  );
});

// Render an assistant text record with markdown
const AssistantTextRecord = memo(function AssistantTextRecord({
  record,
}: {
  record: Extract<TranscriptRecord, { type: "assistant_text" }>;
}) {
  return (
    <div className="py-1">
      <div className={PROSE_CLASSES}>
        <Markdown remarkPlugins={[remarkGfm]}>{record.text}</Markdown>
      </div>
    </div>
  );
});

// Render a thinking block with collapsible details
const ThinkingRecord = memo(function ThinkingRecord({
  record,
}: {
  record: Extract<TranscriptRecord, { type: "thinking" }>;
}) {
  const lineCount = record.text.split("\n").length;
  const [open, setOpen] = useState(false);
  return (
    <details className="py-1 group" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer text-zinc-500 text-xs select-none hover:text-zinc-400 transition-colors">
        <span className="mr-1">{"💭"}</span>
        Thinking ({lineCount} {lineCount === 1 ? "line" : "lines"})
      </summary>
      {open && (
        <div className={`mt-1 pl-4 border-l border-zinc-700/50 text-zinc-500 ${PROSE_CLASSES}`}>
          <Markdown remarkPlugins={[remarkGfm]}>{record.text}</Markdown>
        </div>
      )}
    </details>
  );
});

// Render a tool use record with expandable details
const ToolUseRecord = memo(function ToolUseRecord({
  record,
}: {
  record: Extract<TranscriptRecord, { type: "tool_use" }>;
}) {
  const [showFull, setShowFull] = useState(false);
  const summary = record.input_summary ? `: ${truncate(record.input_summary, 120)}` : "";
  return (
    <div className="py-0.5 pl-2">
      <span className={toolColor(record.tool_name)}>
        {"⚙ "}
        {record.tool_name}
      </span>
      <span className="text-zinc-400">{summary}</span>
      {record.input_full && (
        <button
          type="button"
          onClick={() => setShowFull(!showFull)}
          className="ml-2 text-zinc-600 text-xs hover:text-zinc-400 transition-colors"
        >
          {showFull ? "▾ hide" : "▸ details"}
        </button>
      )}
      {showFull && record.input_full && (
        <pre className="mt-1 ml-4 text-xs text-zinc-500 bg-zinc-900/50 border border-white/5 rounded p-2 overflow-x-auto max-h-40">
          {JSON.stringify(record.input_full, null, 2)}
        </pre>
      )}
    </div>
  );
});

// Render a tool result record
const ToolResultRecord = memo(function ToolResultRecord({
  record,
}: {
  record: Extract<TranscriptRecord, { type: "tool_result" }>;
}) {
  const firstLine = record.output_summary.split("\n")[0] ?? record.output_summary;
  const isError = record.is_error === true;
  return (
    <div className="py-0.5 pl-2">
      <span className={isError ? "text-red-500" : "text-green-600"}>{isError ? "✗ " : "✓ "}</span>
      <span className={isError ? "text-red-400/70" : "text-zinc-500"}>
        {truncate(firstLine, 150)}
      </span>
    </div>
  );
});

// Render a single transcript record by type
const TranscriptRecordItem = memo(function TranscriptRecordItem({
  record,
}: {
  record: TranscriptRecord;
}) {
  switch (record.type) {
    case "user":
      return <UserRecord record={record} />;
    case "assistant_text":
      return <AssistantTextRecord record={record} />;
    case "thinking":
      return <ThinkingRecord record={record} />;
    case "tool_use":
      return <ToolUseRecord record={record} />;
    case "tool_result":
      return <ToolResultRecord record={record} />;
  }
});

// Main transcript view — renders a list of transcript records
export function TranscriptView({ records }: TranscriptViewProps) {
  if (records.length === 0) return null;

  return (
    <div className="flex flex-col">
      {records.map((record, index) => (
        <TranscriptRecordItem key={record.uuid ?? index} record={record} />
      ))}
    </div>
  );
}
