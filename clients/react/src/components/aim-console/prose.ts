// Shared markdown prose classes. Same palette the transcript / aim-body
// markdown uses so bodies read like the rest of the WebUI. Standard markdown
// rendering is the ONE allowed convention inside prose. Consumed by
// `TranscriptView` and `AimBody`; the R₂ content viewers (`RPrViewer` /
// `RRecordViewer`) were removed in the 2026-07-01 producer-console rip and a
// live-fetch confirm viewer is being rebuilt on the aim console (aim
// `act-in-tmai`).

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
