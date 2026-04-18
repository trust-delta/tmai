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

// Tool name color mapping (cyan/teal palette matching Claude Code)
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
  return TOOL_COLORS[name] ?? "text-cyan-400";
}

// Truncate a string at a max length
function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}...` : s;
}

// Check if a record starts a new user turn (for separator rendering)
function isNewTurn(record: TranscriptRecord, index: number): boolean {
  return record.type === "user" && index > 0;
}

// Render a user message record — mimics Claude Code's `❯` prompt style
const UserRecord = memo(function UserRecord({
  record,
}: {
  record: Extract<TranscriptRecord, { type: "user" }>;
}) {
  const firstLine = record.text.split("\n")[0] ?? record.text;
  return (
    <div className="py-1.5">
      <span className="text-white font-bold">{"❯ "}</span>
      <span className="text-white font-semibold">{truncate(firstLine, 200)}</span>
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
    <div className="py-1 pl-2">
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

// Render a tool use record — cyan/teal `●` label with dimmed input summary
const ToolUseRecord = memo(function ToolUseRecord({
  record,
}: {
  record: Extract<TranscriptRecord, { type: "tool_use" }>;
}) {
  const [showFull, setShowFull] = useState(false);
  const summary = record.input_summary ? truncate(record.input_summary, 120) : "";
  return (
    <div className="py-0.5 pl-2">
      <span className={toolColor(record.tool_name)}>
        {"● "}
        <span className="font-medium">{record.tool_name}</span>
      </span>
      {summary && <span className="text-zinc-500 text-xs ml-1">({summary})</span>}
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

// Maximum lines shown before collapsing tool result output
const TOOL_RESULT_COLLAPSE_THRESHOLD = 3;

// Render a tool result record — gray background block with `⎿` prefix, collapsible
const ToolResultRecord = memo(function ToolResultRecord({
  record,
}: {
  record: Extract<TranscriptRecord, { type: "tool_result" }>;
}) {
  const isError = record.is_error === true;
  const lines = record.output_summary.split("\n");
  const isLong = lines.length > TOOL_RESULT_COLLAPSE_THRESHOLD;
  const [expanded, setExpanded] = useState(false);

  const visibleText =
    isLong && !expanded
      ? `${lines.slice(0, TOOL_RESULT_COLLAPSE_THRESHOLD).join("\n")}…`
      : record.output_summary;

  return (
    <div
      className={`py-1 pl-3 ml-2 my-0.5 rounded border-l-2 font-mono text-xs leading-relaxed ${
        isError ? "border-red-500/40 bg-red-950/20" : "border-zinc-700/50 bg-zinc-900/30"
      }`}
    >
      <div className="flex items-start gap-1">
        <span className={`shrink-0 ${isError ? "text-red-500" : "text-zinc-600"}`}>⎿</span>
        <pre
          className={`whitespace-pre-wrap break-words ${
            isError ? "text-red-400/80" : "text-zinc-500"
          }`}
        >
          {truncate(visibleText, 600)}
        </pre>
      </div>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="mt-1 text-zinc-600 text-[10px] hover:text-zinc-400 transition-colors"
        >
          {expanded ? "▾ collapse" : `▸ ${lines.length} lines — show all`}
        </button>
      )}
    </div>
  );
});

// Turn separator — subtle divider rendered before each new user turn
const TurnSeparator = memo(function TurnSeparator() {
  return <div className="my-2 border-t border-white/5" />;
});

// Render a single transcript record by type, with optional turn separator
const TranscriptRecordItem = memo(function TranscriptRecordItem({
  record,
  index,
}: {
  record: TranscriptRecord;
  index: number;
}) {
  return (
    <>
      {isNewTurn(record, index) && <TurnSeparator />}
      {record.type === "user" && <UserRecord record={record} />}
      {record.type === "assistant_text" && <AssistantTextRecord record={record} />}
      {record.type === "thinking" && <ThinkingRecord record={record} />}
      {record.type === "tool_use" && <ToolUseRecord record={record} />}
      {record.type === "tool_result" && <ToolResultRecord record={record} />}
    </>
  );
});

// Cap the number of records rendered by default.
//
// Rendering every record through react-markdown + remarkGfm scales linearly:
// at ~500 records the initial mount on agent-switch freezes the browser for
// seconds and the 3s transcript refetch keeps it jittery. Operators almost
// always care about the tail of the conversation, so we render the last
// DEFAULT_VISIBLE_COUNT records by default and let the user opt into the
// older history via the toggle button below. Follow-up: #426 (append-event
// stream) obsoletes this cap by making the pressure O(delta) instead of
// O(full history).
//
// 150 still produced noticeable freeze on the initial mount for long-running
// agents (reporter had ~437 records and tab hung). 100 is the smallest cap
// that still shows roughly the last two full user-turn cycles of context
// while keeping mount under ~200ms on the reporter's machine.
const DEFAULT_VISIBLE_COUNT = 100;

// Main transcript view — renders a list of transcript records with Claude Code styling
export function TranscriptView({ records }: TranscriptViewProps) {
  const [showAll, setShowAll] = useState(false);

  if (records.length === 0) return null;

  const capped = !showAll && records.length > DEFAULT_VISIBLE_COUNT;
  const visibleRecords = capped ? records.slice(-DEFAULT_VISIBLE_COUNT) : records;
  const hiddenCount = records.length - visibleRecords.length;

  return (
    <div className="flex flex-col">
      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="self-start mx-2 my-1 px-2 py-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors rounded border border-white/5 hover:border-white/10"
        >
          ▸ Show {hiddenCount} earlier record{hiddenCount === 1 ? "" : "s"}
        </button>
      )}
      {visibleRecords.map((record, index) => (
        <TranscriptRecordItem key={record.uuid ?? index} record={record} index={index} />
      ))}
    </div>
  );
}
