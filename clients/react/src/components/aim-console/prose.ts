// Shared markdown prose classes for the R₂ viewers (PR content + record
// excerpt). Same palette the transcript / digest markdown uses so bodies
// and excerpts read like the rest of the WebUI. Extracted from
// `RPrViewer` so the record viewer (`RRecordViewer`) reuses the EXACT
// styling without restyling — per `2026-05-29-artifact-content-viewer`,
// standard markdown rendering is the ONE allowed convention inside the
// viewer's prose, and it must look identical across both R₂ kinds.

export const PROSE_CLASSES = `prose prose-invert prose-sm max-w-none
  prose-headings:text-foreground prose-headings:font-semibold
  prose-p:text-foreground prose-p:leading-relaxed prose-p:my-1
  prose-a:text-info prose-a:no-underline hover:prose-a:underline
  prose-strong:text-foreground
  prose-code:text-primary prose-code:bg-surface prose-code:rounded prose-code:px-1 prose-code:py-0.5 prose-code:text-xs prose-code:before:content-none prose-code:after:content-none
  prose-pre:bg-surface-strong/50 prose-pre:border prose-pre:border-hairline prose-pre:rounded-lg prose-pre:my-1
  prose-li:text-foreground prose-li:my-0
  prose-ul:my-1 prose-ol:my-1
  prose-th:text-foreground prose-th:border-hairline-strong
  prose-td:text-muted-foreground prose-td:border-hairline-strong
  prose-hr:border-hairline-strong
  prose-blockquote:border-info/30 prose-blockquote:text-muted-foreground`;
