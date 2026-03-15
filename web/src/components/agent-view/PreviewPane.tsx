import type { PreviewResponse } from "../../types/agent";

interface PreviewPaneProps {
  preview: PreviewResponse | null;
}

export function PreviewPane({ preview }: PreviewPaneProps) {
  if (!preview) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-neutral-200 dark:border-neutral-800">
        <span className="text-sm text-neutral-400 dark:text-neutral-600">
          Loading preview...
        </span>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto rounded-lg border border-neutral-300 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-950">
      <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-neutral-700 dark:text-neutral-300">
        {preview.content}
      </pre>
    </div>
  );
}
