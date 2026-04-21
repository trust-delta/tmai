import { isValidElement, type ReactNode, useCallback, useEffect, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, type MdTreeEntry } from "@/lib/api";
import { MermaidBlock } from "./MermaidBlock";

interface MarkdownPanelProps {
  projectPath: string;
  projectName: string;
}

interface CodeElementProps {
  className?: string;
  children?: ReactNode;
}

// Extract the source text of a fenced code block from react-markdown's `children` prop
function extractCodeSource(children: ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(extractCodeSource).join("");
  return String(children ?? "");
}

// react-markdown component overrides: intercept mermaid fenced blocks and render them as SVG
const markdownComponents = {
  pre({ children, ...props }: { children?: ReactNode }) {
    if (isValidElement<CodeElementProps>(children)) {
      const className = children.props.className ?? "";
      if (className === "language-mermaid") {
        const source = extractCodeSource(children.props.children).replace(/\n$/, "");
        return <MermaidBlock source={source} />;
      }
    }
    return <pre {...props}>{children}</pre>;
  },
};

// Panel for browsing and editing markdown files in a project
export function MarkdownPanel({ projectPath, projectName }: MarkdownPanelProps) {
  const [tree, setTree] = useState<MdTreeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [fileLoading, setFileLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [editable, setEditable] = useState(false);
  // Mobile: file tree panel open/closed
  const [treeOpen, setTreeOpen] = useState(false);

  // Fetch file tree
  useEffect(() => {
    setLoading(true);
    api
      .mdTree(projectPath)
      .then(setTree)
      .catch(() => setTree([]))
      .finally(() => setLoading(false));
  }, [projectPath]);

  // Load file content
  const loadFile = useCallback((path: string) => {
    setSelectedFile(path);
    setEditing(false);
    setSaveError(null);
    setFileLoading(true);
    setTreeOpen(false); // Close tree drawer after selecting on mobile
    api
      .readFile(path)
      .then((data) => {
        setContent(data.content);
        setEditContent(data.content);
        setEditable(data.editable ?? false);
      })
      .catch(() => setContent("Failed to load file"))
      .finally(() => setFileLoading(false));
  }, []);

  // Save file
  const handleSave = useCallback(async () => {
    if (!selectedFile || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await api.writeFile(selectedFile, editContent);
      setContent(editContent);
      setEditing(false);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }, [selectedFile, editContent, saving]);

  // Auto-select CLAUDE.md if it exists
  useEffect(() => {
    if (tree.length > 0 && !selectedFile) {
      const claude = findFile(tree, "CLAUDE.md");
      if (claude) loadFile(claude);
    }
  }, [tree, selectedFile, loadFile]);

  const fileTree = (
    <>
      {loading ? (
        <div className="px-3 py-2 text-xs text-zinc-500">Loading...</div>
      ) : tree.length === 0 ? (
        <div className="px-3 py-2 text-xs text-zinc-500">No markdown files</div>
      ) : (
        <TreeNode entries={tree} selectedFile={selectedFile} onSelect={loadFile} depth={0} />
      )}
    </>
  );

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="glass shrink-0 border-b border-white/5 px-4 py-3">
        <div className="flex items-center gap-3">
          {/* Mobile: toggle file tree button */}
          <button
            type="button"
            onClick={() => setTreeOpen((v) => !v)}
            className="touch-target flex items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-white/10 hover:text-zinc-300 md:hidden"
            title="Toggle file list"
            aria-label="Toggle file list"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <title>Files</title>
              <rect x="2" y="2" width="5" height="5" rx="0.5" />
              <rect x="9" y="2" width="5" height="5" rx="0.5" />
              <rect x="2" y="9" width="5" height="5" rx="0.5" />
              <rect x="9" y="9" width="5" height="5" rx="0.5" />
            </svg>
          </button>
          <svg
            width="20"
            height="20"
            viewBox="0 0 16 16"
            fill="none"
            className="hidden shrink-0 text-blue-400 md:block"
            role="img"
            aria-label="Document icon"
          >
            <title>Document icon</title>
            <rect
              x="2"
              y="1"
              width="12"
              height="14"
              rx="1"
              stroke="currentColor"
              strokeWidth="1.5"
              fill="none"
            />
            <line
              x1="5"
              y1="5"
              x2="11"
              y2="5"
              stroke="currentColor"
              strokeWidth="1"
              opacity="0.5"
            />
            <line
              x1="5"
              y1="8"
              x2="11"
              y2="8"
              stroke="currentColor"
              strokeWidth="1"
              opacity="0.5"
            />
            <line
              x1="5"
              y1="11"
              x2="9"
              y2="11"
              stroke="currentColor"
              strokeWidth="1"
              opacity="0.5"
            />
          </svg>
          <h2 className="truncate text-base font-semibold text-zinc-100">{projectName}</h2>
          <span className="shrink-0 text-xs text-zinc-500">Markdown</span>
        </div>
      </div>

      <div className="relative flex flex-1 overflow-hidden">
        {/* Mobile: file tree as overlay drawer */}
        {treeOpen && (
          <>
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop tap to close */}
            {/* biome-ignore lint/a11y/noStaticElementInteractions: backdrop tap to close */}
            <div
              className="absolute inset-0 z-10 bg-black/50 md:hidden"
              onClick={() => setTreeOpen(false)}
            />
            <div className="absolute inset-y-0 left-0 z-20 w-56 overflow-y-auto border-r border-white/5 bg-zinc-950 py-2 md:hidden animate-slide-in-left">
              {fileTree}
            </div>
          </>
        )}

        {/* Desktop: file tree as persistent sidebar */}
        <div className="hidden w-56 shrink-0 overflow-y-auto border-r border-white/5 bg-black/10 py-2 md:block">
          {fileTree}
        </div>

        {/* Right: Preview / Editor */}
        <div className="flex flex-1 flex-col overflow-auto">
          {!selectedFile ? (
            <div className="flex items-center justify-center py-20 text-sm text-zinc-500">
              {treeOpen ? null : "Select a file to preview"}
            </div>
          ) : fileLoading ? (
            <div className="flex items-center justify-center py-20 text-sm text-zinc-500">
              Loading...
            </div>
          ) : editing ? (
            <div className="flex flex-1 flex-col h-full">
              {/* Editor toolbar */}
              <div className="flex items-center gap-2 border-b border-white/5 px-4 py-2">
                <span className="text-xs text-zinc-400 font-mono truncate flex-1">
                  {selectedFile.split("/").pop()}
                </span>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="touch-target-sm rounded bg-blue-500/20 px-3 py-1 text-xs text-blue-400 hover:bg-blue-500/30 disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false);
                    setEditContent(content);
                    setSaveError(null);
                  }}
                  className="touch-target-sm rounded bg-white/5 px-3 py-1 text-xs text-zinc-400 hover:bg-white/10"
                >
                  Cancel
                </button>
              </div>
              {saveError && (
                <div className="border-b border-red-500/20 bg-red-500/5 px-4 py-1 text-xs text-red-400">
                  {saveError}
                </div>
              )}
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="flex-1 resize-none bg-transparent px-4 py-4 font-mono text-sm text-zinc-200 outline-none md:px-6"
                spellCheck={false}
              />
            </div>
          ) : (
            <div className="flex flex-1 flex-col h-full">
              {/* Preview toolbar */}
              <div className="flex items-center gap-2 border-b border-white/5 px-4 py-2">
                <span className="text-xs text-zinc-400 font-mono truncate flex-1">
                  {selectedFile.split("/").pop()}
                </span>
                {editable ? (
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    className="touch-target-sm rounded bg-white/5 px-3 py-1 text-xs text-zinc-400 hover:bg-white/10 hover:text-zinc-200"
                  >
                    Edit
                  </button>
                ) : (
                  <span className="text-[10px] text-zinc-600">read-only</span>
                )}
              </div>
              {/* Content: markdown preview or code view */}
              <div className="flex-1 overflow-auto px-4 py-4 md:px-6">
                {selectedFile.endsWith(".md") ? (
                  <div
                    className="prose prose-invert prose-sm max-w-none
                    prose-headings:text-zinc-100 prose-headings:font-semibold
                    prose-p:text-zinc-300 prose-p:leading-relaxed
                    prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline
                    prose-strong:text-zinc-200
                    prose-code:text-cyan-400 prose-code:bg-white/5 prose-code:rounded prose-code:px-1 prose-code:py-0.5 prose-code:text-xs prose-code:before:content-none prose-code:after:content-none
                    prose-pre:bg-zinc-900/50 prose-pre:border prose-pre:border-white/5 prose-pre:rounded-lg prose-pre:overflow-x-auto
                    prose-li:text-zinc-300
                    prose-th:text-zinc-300 prose-th:border-white/10
                    prose-td:text-zinc-400 prose-td:border-white/10
                    prose-hr:border-white/10
                    prose-blockquote:border-blue-500/30 prose-blockquote:text-zinc-400
                  "
                  >
                    <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                      {content}
                    </Markdown>
                  </div>
                ) : (
                  <pre className="text-xs text-zinc-300 font-mono whitespace-pre-wrap break-words select-text leading-relaxed">
                    {content}
                  </pre>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/// Get a short extension label for display
function extLabel(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    md: "MD",
    json: "JS",
    toml: "TM",
    txt: "TX",
    yaml: "YM",
    yml: "YM",
    rs: "RS",
    ts: "TS",
    tsx: "TX",
    js: "JS",
    jsx: "JX",
    css: "CS",
    html: "HT",
    lock: "LK",
    sh: "SH",
    py: "PY",
    go: "GO",
  };
  return map[ext] ?? ext.slice(0, 2).toUpperCase();
}

// Recursive tree node component
function TreeNode({
  entries,
  selectedFile,
  onSelect,
  depth,
}: {
  entries: MdTreeEntry[];
  selectedFile: string | null;
  onSelect: (path: string) => void;
  depth: number;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  return (
    <>
      {entries.map((entry) => {
        if (entry.is_dir) {
          const isCollapsed = collapsed.has(entry.path);
          return (
            <div key={entry.path}>
              <button
                type="button"
                onClick={() =>
                  setCollapsed((prev) => {
                    const next = new Set(prev);
                    if (next.has(entry.path)) next.delete(entry.path);
                    else next.add(entry.path);
                    return next;
                  })
                }
                className="flex w-full items-center gap-1 py-1.5 text-left text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
                style={{ paddingLeft: 8 + depth * 12, paddingRight: 8 }}
              >
                <span className="text-[9px]">{isCollapsed ? "\u25B8" : "\u25BE"}</span>
                <span className="truncate">{entry.name}</span>
              </button>
              {!isCollapsed && entry.children && (
                <TreeNode
                  entries={entry.children}
                  selectedFile={selectedFile}
                  onSelect={onSelect}
                  depth={depth + 1}
                />
              )}
            </div>
          );
        }
        const isSelected = selectedFile === entry.path;
        return (
          <button
            type="button"
            key={entry.path}
            onClick={() => onSelect(entry.path)}
            className={`flex w-full items-center gap-1.5 py-1.5 text-left text-[11px] transition-colors ${
              isSelected
                ? "bg-blue-500/10 text-blue-400"
                : entry.openable
                  ? "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
                  : "text-zinc-600 hover:bg-white/[0.03] hover:text-zinc-400"
            }`}
            style={{ paddingLeft: 8 + depth * 12, paddingRight: 8 }}
          >
            <span
              className={`shrink-0 text-[10px] ${
                isSelected ? "text-blue-500" : entry.openable ? "text-zinc-500" : "text-zinc-700"
              }`}
            >
              {extLabel(entry.name)}
            </span>
            <span className="truncate">{entry.name}</span>
          </button>
        );
      })}
    </>
  );
}

// Find a specific openable filename in the tree (recursive search)
function findFile(entries: MdTreeEntry[], name: string): string | null {
  for (const entry of entries) {
    if (!entry.is_dir && entry.openable && entry.name === name) return entry.path;
    if (entry.is_dir && entry.children) {
      const found = findFile(entry.children, name);
      if (found) return found;
    }
  }
  return null;
}
