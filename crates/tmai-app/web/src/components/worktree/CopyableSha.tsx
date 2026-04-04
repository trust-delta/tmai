import { useCallback, useRef, useState } from "react";

interface CopyableShaProps {
  /** Full commit SHA (will be copied to clipboard) */
  sha: string;
  /** Number of characters to display (default: 7) */
  displayLength?: number;
  /** Additional CSS classes for the container */
  className?: string;
  /** Inline styles for the text span */
  style?: React.CSSProperties;
}

// Clickable SHA label that copies full SHA to clipboard with brief visual feedback
export function CopyableSha({ sha, displayLength = 7, className = "", style }: CopyableShaProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      navigator.clipboard.writeText(sha).then(() => {
        if (timerRef.current) clearTimeout(timerRef.current);
        setCopied(true);
        timerRef.current = setTimeout(() => setCopied(false), 1200);
      });
    },
    [sha],
  );

  return (
    <button
      type="button"
      onClick={handleClick}
      title={copied ? "Copied!" : `Click to copy ${sha}`}
      className={`shrink-0 cursor-pointer font-mono transition-colors ${className}`}
      style={style}
    >
      {copied ? "Copied!" : sha.slice(0, displayLength)}
    </button>
  );
}
