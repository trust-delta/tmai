import type { AutoSaveStatus } from "@/hooks/useAutoSave";

interface SaveStatusProps {
  status: AutoSaveStatus;
  error?: string | null;
  /**
   * Where the indicator is rendered. "inline" is for next to a single field;
   * "section" is for the section header. Both share the same visual language
   * but section adds a leading spacing margin.
   */
  variant?: "inline" | "section";
  className?: string;
}

const baseCls = "text-[10px] inline-flex items-center gap-1 select-none";

/**
 * Compact saved/saving/error indicator used by the auto-saved Settings fields.
 * The "saved" tick is intentionally low-contrast so it does not draw attention
 * away from the field — it is a confirmation, not an alert.
 */
export function SaveStatus({ status, error, variant = "inline", className = "" }: SaveStatusProps) {
  if (status === "idle") return null;
  const root = `${baseCls} ${variant === "section" ? "ml-2" : ""} ${className}`.trim();

  if (status === "saving") {
    return (
      <span className={`${root} text-zinc-500`} role="status" aria-live="polite">
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-500" />
        Saving…
      </span>
    );
  }
  if (status === "saved") {
    return (
      <span className={`${root} text-emerald-500/80`} role="status" aria-live="polite">
        <span aria-hidden="true">✓</span>
        Saved
      </span>
    );
  }
  // error
  return (
    <span className={`${root} text-red-400`} role="alert">
      <span aria-hidden="true">⚠</span>
      <span className="break-words">{error ?? "Save failed"}</span>
    </span>
  );
}
