import { useCallback, useEffect, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, type IssueDetail } from "@/lib/api";

interface IssueDetailPanelProps {
  issueNumber: number;
  projectPath: string;
  onClose: () => void;
}

// Format ISO timestamp as relative time string
function formatRelative(iso: string): string {
  if (!iso) return "";
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// Shared prose class for rendered markdown
const proseClassName = `prose prose-invert prose-sm max-w-none
  prose-headings:text-zinc-100 prose-headings:font-semibold
  prose-p:text-zinc-300 prose-p:leading-relaxed
  prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline
  prose-strong:text-zinc-200
  prose-code:text-cyan-400 prose-code:bg-white/5 prose-code:rounded prose-code:px-1 prose-code:py-0.5 prose-code:text-xs prose-code:before:content-none prose-code:after:content-none
  prose-pre:bg-zinc-900/50 prose-pre:border prose-pre:border-white/5 prose-pre:rounded-lg
  prose-li:text-zinc-300
  prose-th:text-zinc-300 prose-th:border-white/10
  prose-td:text-zinc-400 prose-td:border-white/10
  prose-hr:border-white/10
  prose-blockquote:border-blue-500/30 prose-blockquote:text-zinc-400`;

// Issue detail panel — shows full issue info when selected in Issues tab
export function IssueDetailPanel({ issueNumber, projectPath, onClose }: IssueDetailPanelProps) {
  const [detail, setDetail] = useState<IssueDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch issue detail from backend
  const fetchDetail = useCallback(async () => {
    try {
      const data = await api.getIssueDetail(projectPath, issueNumber);
      setDetail(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load issue detail");
    } finally {
      setLoading(false);
    }
  }, [projectPath, issueNumber]);

  useEffect(() => {
    setLoading(true);
    fetchDetail();
  }, [fetchDetail]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(fetchDetail, 30_000);
    return () => clearInterval(interval);
  }, [fetchDetail]);

  return (
    <div className="min-w-[480px] flex-[2] overflow-hidden flex flex-col border-l border-white/5 bg-black/20">
      {/* Header */}
      <div className="shrink-0 flex items-center gap-2 border-b border-white/5 px-4 py-2">
        <h3 className="flex-1 text-sm font-semibold text-zinc-100 truncate">
          Issue #{issueNumber}
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded p-1 text-zinc-500 transition-colors hover:bg-white/10 hover:text-zinc-200"
          title="Close detail panel"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <title>Close</title>
            <path
              d="M3.5 3.5L10.5 10.5M10.5 3.5L3.5 10.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto p-4">
        {loading && <div className="text-sm text-zinc-500">Loading issue detail...</div>}
        {error && <div className="text-sm text-red-400">{error}</div>}
        {!loading && !error && detail && (
          <div className="flex flex-col gap-4">
            {/* Title and state */}
            <div>
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    detail.state === "OPEN"
                      ? "bg-green-500/15 text-green-400"
                      : "bg-purple-500/15 text-purple-400"
                  }`}
                >
                  {detail.state}
                </span>
                {detail.labels.map((label) => (
                  <span
                    key={label.name}
                    className="rounded-full px-1.5 py-0.5 text-[10px]"
                    style={{
                      backgroundColor: `#${label.color}22`,
                      color: `#${label.color}`,
                    }}
                  >
                    {label.name}
                  </span>
                ))}
              </div>
              <h2 className="mt-2 text-base font-semibold text-zinc-100">{detail.title}</h2>
            </div>

            {/* Metadata */}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-500">
              {detail.assignees.length > 0 && <span>Assignees: {detail.assignees.join(", ")}</span>}
              {detail.created_at && <span>Created {formatRelative(detail.created_at)}</span>}
              {detail.updated_at && <span>Updated {formatRelative(detail.updated_at)}</span>}
            </div>

            {/* GitHub link */}
            <a
              href={detail.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-fit items-center gap-1.5 rounded-md bg-white/5 px-2.5 py-1.5 text-xs text-zinc-300 transition-colors hover:bg-white/10 hover:text-zinc-100"
            >
              Open on GitHub
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <title>External link</title>
                <path
                  d="M4.5 2H2.5C2.224 2 2 2.224 2 2.5V9.5C2 9.776 2.224 10 2.5 10H9.5C9.776 10 10 9.776 10 9.5V7.5M7 2H10M10 2V5M10 2L5 7"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </a>

            {/* Body (rendered markdown) */}
            {detail.body && (
              <div
                className={`rounded-lg border border-white/5 bg-white/[0.02] p-4 ${proseClassName}`}
              >
                <Markdown remarkPlugins={[remarkGfm]}>{detail.body}</Markdown>
              </div>
            )}

            {/* Comments */}
            {detail.comments.length > 0 && (
              <div className="flex flex-col gap-3">
                <h4 className="text-xs font-semibold text-zinc-400">
                  {detail.comments.length} comment{detail.comments.length !== 1 ? "s" : ""}
                </h4>
                {detail.comments.map((comment) => (
                  <div
                    key={comment.url}
                    className="rounded-lg border border-white/5 bg-white/[0.02] p-3"
                  >
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-semibold text-zinc-200">{comment.author}</span>
                      <span className="text-zinc-600">{formatRelative(comment.created_at)}</span>
                    </div>
                    <div className={`mt-2 ${proseClassName}`}>
                      <Markdown remarkPlugins={[remarkGfm]}>{comment.body}</Markdown>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
