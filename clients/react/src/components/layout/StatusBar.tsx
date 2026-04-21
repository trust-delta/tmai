interface StatusBarProps {
  agentCount: number;
  attentionCount: number;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onSettingsClick: () => void;
  onSecurityClick: () => void;
  /** Mobile: show hamburger button instead of collapse arrow */
  isMobile?: boolean;
  onMobileMenuClick?: () => void;
}

// Top status bar with glassmorphism
export function StatusBar({
  agentCount,
  attentionCount,
  collapsed,
  onToggleCollapse,
  onSettingsClick,
  onSecurityClick,
  isMobile,
  onMobileMenuClick,
}: StatusBarProps) {
  if (isMobile) {
    return (
      <div className="flex items-center justify-between border-b border-white/5 px-3 py-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onMobileMenuClick}
            className="touch-target flex items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/10 hover:text-cyan-400"
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
          <span className="bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-sm font-bold tracking-wide text-transparent">
            tmai
          </span>
          {attentionCount > 0 && (
            <span className="glow-amber rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-400">
              {attentionCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onSecurityClick}
            className="touch-target flex items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-white/10 hover:text-cyan-400"
            title="Config Audit"
          >
            🛡
          </button>
          <button
            type="button"
            onClick={onSettingsClick}
            className="touch-target flex items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-white/10 hover:text-cyan-400"
            title="Settings"
          >
            ⚙
          </button>
        </div>
      </div>
    );
  }

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-2 border-b border-white/5 px-2 py-3">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="rounded px-1.5 py-0.5 text-zinc-500 transition-colors hover:bg-white/10 hover:text-cyan-400"
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
        <span className="bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-xs font-bold text-transparent">
          tm
        </span>
        {attentionCount > 0 && (
          <span className="glow-amber rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-400">
            {attentionCount}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
      <div className="flex items-center gap-2">
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            className="rounded px-1 py-0.5 text-zinc-500 transition-colors hover:bg-white/10 hover:text-cyan-400"
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
        <span className="bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-sm font-bold tracking-wide text-transparent">
          tmai
        </span>
      </div>
      <div className="flex items-center gap-2 text-xs">
        <span className="text-zinc-500">{agentCount} agents</span>
        {attentionCount > 0 && (
          <span className="glow-amber rounded-full bg-amber-500/15 px-2.5 py-0.5 text-amber-400">
            {attentionCount}
          </span>
        )}
        <button
          type="button"
          onClick={onSecurityClick}
          className="rounded px-1.5 py-0.5 text-zinc-500 transition-colors hover:bg-white/10 hover:text-cyan-400"
          title="Config Audit"
        >
          🛡
        </button>
        <button
          type="button"
          onClick={onSettingsClick}
          className="rounded px-1.5 py-0.5 text-zinc-500 transition-colors hover:bg-white/10 hover:text-cyan-400"
          title="Settings"
        >
          ⚙
        </button>
      </div>
    </div>
  );
}
