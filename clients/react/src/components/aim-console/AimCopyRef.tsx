// Copy-reference affordance (aim: `operator-cites-aim`). A small, unobtrusive
// glyph button that writes a POINTER to the clipboard so the operator can hand
// the Producer a reference to an aim node (`[[slug]]`) or to a specific PROCESS
// todo (`[[slug]] <item text>`) without retyping the slug + the item text.
//
// The payload is a POINTER ONLY — no intent verb ("do" / "explain"). The
// operator adds the verb; tmai just makes the reference cheap to hand over
// (the `[[slug]]` wikilink the Producer resolves via get_aims / get_status).
//
// Clipboard mechanism mirrors `terminal/CopySourceOverlay.tsx`: guard on
// `navigator.clipboard` (absent in some embeddings / jsdom) and never throw.

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { AimBodyVariant } from "./AimBody";

interface CopyRefButtonProps {
  /** The exact string written to the clipboard — an already-formatted pointer. */
  text: string;
  /** Which surface's tokens to speak (console `.ac-*` / rpanel tailwind). */
  variant: AimBodyVariant;
  /** Accessible label / tooltip — the operator hears WHAT this copies. */
  label: string;
  /** Test hook; distinct per placement (slug head vs per-item) when needed. */
  testId?: string;
}

// A brief post-copy ✓, cleared after this long — long enough to register, short
// enough not to linger as state on the row.
const COPIED_MS = 1200;

export function CopyRefButton({
  text,
  variant,
  label,
  testId = "aim-copy-ref",
}: CopyRefButtonProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );

  const onCopy = useCallback(() => {
    // No clipboard API → no-op (never throw); same guard as CopySourceOverlay.
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true);
        if (timerRef.current !== null) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setCopied(false), COPIED_MS);
      },
      () => {},
    );
  }, [text]);

  const className =
    variant === "console"
      ? "ac-copyref"
      : cn(
          "ml-1 shrink-0 rounded font-mono text-[10px] leading-none transition-colors",
          copied ? "text-success" : "text-subtle-foreground hover:text-info",
        );

  return (
    <button
      type="button"
      className={className}
      onClick={onCopy}
      aria-label={label}
      title={label}
      data-testid={testId}
      data-copied={copied ? "true" : undefined}
    >
      <span aria-hidden="true">{copied ? "✓" : "⧉"}</span>
    </button>
  );
}
