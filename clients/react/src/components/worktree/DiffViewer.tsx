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
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(() =>
    defaultCollapsed ? new Set(files.map((f) => f.filename)) : new Set(),
  );

  const toggleFile = (filename: string) => {
    setCollapsedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filename)) {
        next.delete(filename);
      } else {
        next.add(filename);
      }
      return next;
    });
  };

  if (files.length === 0) {
    return <div className="px-4 py-6 text-center text-sm text-muted-foreground">No changes</div>;
  }

  return (
    <div className="flex flex-col gap-2">
      {files.map((file) => (
        <div key={file.filename} className="overflow-hidden rounded-lg border border-hairline">
          {/* File header */}
          <button
            type="button"
            onClick={() => toggleFile(file.filename)}
            className="flex w-full items-center gap-2 bg-surface px-3 py-1.5 text-left transition-colors hover:bg-surface"
          >
            <span className="text-[10px] text-subtle-foreground">
              {collapsedFiles.has(file.filename) ? "▸" : "▾"}
            </span>
            <span className="flex-1 truncate text-xs font-mono text-foreground">
              {file.filename}
            </span>
            <span className="shrink-0 text-[10px]">
              <span className="text-success">+{file.insertions}</span>{" "}
              <span className="text-destructive">-{file.deletions}</span>
            </span>
          </button>

          {/* Diff lines */}
          {!collapsedFiles.has(file.filename) && (
            <pre className="overflow-x-auto text-[11px] leading-relaxed">
              {file.lines.map((line, lineIdx) => (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: diff lines are stable, no reordering
                  key={`${file.filename}-L${lineIdx}`}
                  className={cn(
                    "px-3",
                    line.startsWith("+") && !line.startsWith("+++") && "bg-success/10 text-success",
                    line.startsWith("-") &&
                      !line.startsWith("---") &&
                      "bg-destructive/10 text-destructive",
                    line.startsWith("@@") && "bg-info/10 text-info",
                    !line.startsWith("+") &&
                      !line.startsWith("-") &&
                      !line.startsWith("@@") &&
                      "text-muted-foreground",
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
