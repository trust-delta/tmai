import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";

interface DiffFile {
  filename: string;
  insertions: number;
  deletions: number;
  lines: string[];
}

// Parse unified diff text into file sections
function parseDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  const sections = diff.split(/^diff --git /m);

  for (const section of sections) {
    if (!section.trim()) continue;

    // Extract filename from "a/path b/path"
    const headerMatch = section.match(/^a\/(.+?) b\//);
    const filename = headerMatch?.[1] ?? "unknown";

    const lines = section.split("\n");
    let insertions = 0;
    let deletions = 0;

    for (const line of lines) {
      if (line.startsWith("+") && !line.startsWith("+++")) insertions++;
      if (line.startsWith("-") && !line.startsWith("---")) deletions++;
    }

    files.push({ filename, insertions, deletions, lines });
  }

  return files;
}

interface DiffViewerProps {
  diff: string;
}

// Unified diff viewer with file-level collapsing and syntax coloring
export function DiffViewer({ diff }: DiffViewerProps) {
  const files = useMemo(() => parseDiff(diff), [diff]);
  const defaultCollapsed = files.length > 20;
  const [collapsedFiles, setCollapsedFiles] = useState<Set<number>>(() =>
    defaultCollapsed ? new Set(files.map((_, i) => i)) : new Set(),
  );

  const toggleFile = (index: number) => {
    setCollapsedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  if (files.length === 0) {
    return (
      <div className="px-4 py-6 text-center text-sm text-zinc-500">
        No changes
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {files.map((file, i) => (
        <div key={i} className="overflow-hidden rounded-lg border border-white/5">
          {/* File header */}
          <button
            onClick={() => toggleFile(i)}
            className="flex w-full items-center gap-2 bg-white/[0.03] px-3 py-1.5 text-left transition-colors hover:bg-white/[0.06]"
          >
            <span className="text-[10px] text-zinc-600">
              {collapsedFiles.has(i) ? "▸" : "▾"}
            </span>
            <span className="flex-1 truncate text-xs font-mono text-zinc-300">
              {file.filename}
            </span>
            <span className="shrink-0 text-[10px]">
              <span className="text-emerald-400">+{file.insertions}</span>
              {" "}
              <span className="text-red-400">-{file.deletions}</span>
            </span>
          </button>

          {/* Diff lines */}
          {!collapsedFiles.has(i) && (
            <pre className="overflow-x-auto text-[11px] leading-relaxed">
              {file.lines.map((line, j) => (
                <div
                  key={j}
                  className={cn(
                    "px-3",
                    line.startsWith("+") && !line.startsWith("+++") && "bg-emerald-500/10 text-emerald-300",
                    line.startsWith("-") && !line.startsWith("---") && "bg-red-500/10 text-red-300",
                    line.startsWith("@@") && "bg-blue-500/10 text-blue-300",
                    !line.startsWith("+") && !line.startsWith("-") && !line.startsWith("@@") && "text-zinc-500",
                  )}
                >
                  {line}
                </div>
              ))}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}
