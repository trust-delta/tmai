import type { ReactNode } from "react";
import type { ConsoleMode } from "@/components/aim-console/console-mode";

interface StatusBarProps {
  agentCount: number;
  attentionCount: number;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onSettingsClick: () => void;
  onSecurityClick: () => void;
  /** Coexist toggle (aim node `tmai-core:doc/aims/aim-ui.md`): which
   *  top-level console is shown. `producer` (default) = the existing
   *  hand-over digest console; `aim` = the new full-window 3-pane aim
   *  console. The toggle button below ENTERS aim-ui (its EXIT pair lives
   *  in the aim console's own top bar, since that console replaces this
   *  StatusBar while shown). Omitting `onToggleConsoleMode` hides the
   *  button (e.g. the collapsed sidebar, which has no settings cluster). */
  consoleMode?: ConsoleMode;
  onToggleConsoleMode?: () => void;
  /** Optional pre-rendered indicator slot — currently used for the
   *  calibration / tier-1 tripwire chip (DR §B.3/§B.4). Sits between
   *  the attention count and the settings / security buttons. */
  indicatorSlot?: ReactNode;
  /** Producer-console return affordance.
   *  When defined, render a 🏠 button that clears the main-pane selection
   *  and drops the operator back on the ProducerConsole hand-over digest.
   *  Caller is responsible for the actual reset (e.g. `setSelection(null)`);
   *  the Producer agent session itself stays alive in the sidebar so the
   *  conversation can be resumed by re-selecting it.
   *  Use case: dogfood feedback 2026-05-14 — operator was talking to the
   *  Producer in the main pane with no obvious way to glance back at the
   *  digest without closing the session. */
  onReturnToConsole?: () => void;
  /** Mobile: show hamburger button instead of collapse arrow */
  isMobile?: boolean;
  onMobileMenuClick?: () => void;
  /** Unit-tab strip (C1) rendered as a second row below the brand row in
   *  the desktop (expanded) and mobile variants. Omitted in the collapsed
   *  sidebar (too narrow). Composed by App from `useUnits`. */
  unitTabs?: ReactNode;
}

// Top status bar with glassmorphism
export function StatusBar({
  agentCount,
  attentionCount,
  collapsed,
  onToggleCollapse,
  onSettingsClick,
  onSecurityClick,
  consoleMode = "producer",
  onToggleConsoleMode,
  indicatorSlot,
  onReturnToConsole,
  isMobile,
  onMobileMenuClick,
  unitTabs,
}: StatusBarProps) {
  // Coexist console-mode toggle. Rendered next to the Settings/Security
  // cluster (the desktop-expanded + mobile chrome where those buttons live).
  // In practice this StatusBar only renders while `producer` is active — the
  // aim console takes over the whole shell once entered — so the label is
  // derived from `consoleMode` purely for correctness.
  const consoleModeButton = onToggleConsoleMode ? (
    <button
      type="button"
      onClick={onToggleConsoleMode}
      aria-pressed={consoleMode === "aim"}
      className="rounded px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-surface-strong hover:text-primary"
      title={
        consoleMode === "aim"
          ? "Switch to the Producer console"
          : "Switch to the aim console (preview)"
      }
      aria-label={
        consoleMode === "aim" ? "Switch to the Producer console" : "Switch to the aim console"
      }
    >
      ◎
    </button>
  ) : null;

  if (isMobile) {
    return (
      <div className="border-b border-hairline">
        <div className="flex items-center justify-between px-3 py-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onMobileMenuClick}
              className="touch-target flex items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-strong hover:text-primary"
              title="Open navigation"
              aria-label="Open navigation menu"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              >
                <title>Menu</title>
                <path d="M3 5h14M3 10h14M3 15h14" />
              </svg>
            </button>
            <span className="bg-gradient-to-r from-[var(--brand-from)] to-[var(--brand-to)] bg-clip-text text-sm font-bold tracking-wide text-transparent">
              tmai
            </span>
            {attentionCount > 0 && (
              <span className="glow-amber rounded-full bg-warning/15 px-2 py-0.5 text-xs text-warning">
                {attentionCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {onReturnToConsole && (
              <button
                type="button"
                onClick={onReturnToConsole}
                className="touch-target flex items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-strong hover:text-primary"
                title="Return to Producer console"
                aria-label="Return to Producer console"
              >
                🏠
              </button>
            )}
            {consoleModeButton}
            <button
              type="button"
              onClick={onSecurityClick}
              className="touch-target flex items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-strong hover:text-primary"
              title="Config Audit"
            >
              🛡
            </button>
            <button
              type="button"
              onClick={onSettingsClick}
              className="touch-target flex items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-strong hover:text-primary"
              title="Settings"
            >
              ⚙
            </button>
          </div>
        </div>
        {unitTabs && <div className="overflow-x-auto px-2 pb-2">{unitTabs}</div>}
      </div>
    );
  }

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-2 border-b border-hairline px-2 py-3">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="rounded px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-surface-strong hover:text-primary"
          title="Expand sidebar"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <title>Expand sidebar</title>
            <path d="M6 3l5 5-5 5" />
          </svg>
        </button>
        <span className="bg-gradient-to-r from-[var(--brand-from)] to-[var(--brand-to)] bg-clip-text text-xs font-bold text-transparent">
          tm
        </span>
        {onReturnToConsole && (
          <button
            type="button"
            onClick={onReturnToConsole}
            className="rounded px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-surface-strong hover:text-primary"
            title="Return to Producer console"
            aria-label="Return to Producer console"
          >
            🏠
          </button>
        )}
        {attentionCount > 0 && (
          <span className="glow-amber rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] text-warning">
            {attentionCount}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="border-b border-hairline">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          {onToggleCollapse && (
            <button
              type="button"
              onClick={onToggleCollapse}
              className="rounded px-1 py-0.5 text-muted-foreground transition-colors hover:bg-surface-strong hover:text-primary"
              title="Collapse sidebar"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <title>Collapse sidebar</title>
                <path d="M10 3l-5 5 5 5" />
              </svg>
            </button>
          )}
          <span className="bg-gradient-to-r from-[var(--brand-from)] to-[var(--brand-to)] bg-clip-text text-sm font-bold tracking-wide text-transparent">
            tmai
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">{agentCount} agents</span>
          {attentionCount > 0 && (
            <span className="glow-amber rounded-full bg-warning/15 px-2.5 py-0.5 text-warning">
              {attentionCount}
            </span>
          )}
          {indicatorSlot}
          {onReturnToConsole && (
            <button
              type="button"
              onClick={onReturnToConsole}
              className="rounded px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-surface-strong hover:text-primary"
              title="Return to Producer console"
              aria-label="Return to Producer console"
            >
              🏠
            </button>
          )}
          {consoleModeButton}
          <button
            type="button"
            onClick={onSecurityClick}
            className="rounded px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-surface-strong hover:text-primary"
            title="Config Audit"
          >
            🛡
          </button>
          <button
            type="button"
            onClick={onSettingsClick}
            className="rounded px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-surface-strong hover:text-primary"
            title="Settings"
          >
            ⚙
          </button>
        </div>
      </div>
      {unitTabs && <div className="overflow-x-auto px-2 pb-2">{unitTabs}</div>}
    </div>
  );
}
