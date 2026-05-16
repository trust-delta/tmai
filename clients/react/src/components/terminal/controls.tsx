// Shared footer-bar controls used by both the live `TerminalPanel` (xterm.js)
// and the legacy `PreviewPanel` (AnsiUp). The two panels render different
// content above the footer (xterm canvas vs. AnsiUp HTML, optional
// Live/Transcript tabs, queue badge, etc.) but their mode + auto-scroll
// toggles are identical — DRY them here so future tweaks land once.

interface ModeToggleButtonProps {
  /** True when keystrokes flow to the agent (Input mode). False when the
   *  user can drag-select text without typing into the agent (Select mode). */
  inputMode: boolean;
  onToggle: () => void;
}

/** Pill button that flips between Input and Select mode. */
export function ModeToggleButton({ inputMode, onToggle }: ModeToggleButtonProps) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onToggle}
      className={`touch-target-sm rounded px-2 py-1 text-xs transition-colors ${
        inputMode ? "bg-primary/20 text-primary" : "bg-warning/20 text-warning"
      }`}
      title={
        inputMode
          ? "Input mode — keystrokes sent to agent (click for select mode)"
          : "Select mode — click to copy text (click for input mode)"
      }
    >
      {inputMode ? "⌨ Input" : "📋 Select"}
    </button>
  );
}

interface AutoScrollToggleButtonProps {
  autoScroll: boolean;
  onToggle: () => void;
}

/** Pill button that flips auto-scroll on/off. */
export function AutoScrollToggleButton({ autoScroll, onToggle }: AutoScrollToggleButtonProps) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onToggle}
      className={`touch-target-sm rounded px-2 py-1 text-xs transition-colors ${
        autoScroll
          ? "bg-primary/15 text-primary"
          : "bg-surface text-subtle-foreground hover:text-muted-foreground"
      }`}
      title={autoScroll ? "Auto-scroll: ON" : "Auto-scroll: OFF"}
    >
      {autoScroll ? "⇩ Auto" : "⇩ Off"}
    </button>
  );
}

/**
 * Right-aligned hint text shown at the end of the footer row. Hidden on
 * narrow viewports (`sm:block`) since the buttons themselves carry tooltips.
 */
export function ModeHint({ inputMode }: { inputMode: boolean }) {
  return (
    <span className="hidden text-[10px] text-subtle-foreground sm:block">
      {inputMode ? "click to select" : "Enter or click ⌨ to input"}
    </span>
  );
}
