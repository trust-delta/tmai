interface StatusBarProps {
  agentCount: number;
  attentionCount: number;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onSettingsClick: () => void;
  onSecurityClick: () => void;
  onOrchestratorClick: () => void;
  orchestratorSpawning?: boolean;
  orchestratorRunning?: boolean;
}

// Top status bar with glassmorphism
export function StatusBar({
  agentCount,
  attentionCount,
  collapsed,
  onToggleCollapse,
  onSettingsClick,
  onSecurityClick,
  onOrchestratorClick,
  orchestratorSpawning,
  orchestratorRunning,
}: StatusBarProps) {
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
          onClick={onOrchestratorClick}
          disabled={orchestratorSpawning || orchestratorRunning}
          className={`rounded px-1.5 py-0.5 transition-colors ${
            orchestratorRunning
              ? "text-emerald-400 cursor-default"
              : orchestratorSpawning
                ? "cursor-not-allowed text-zinc-600"
                : "text-zinc-500 hover:bg-white/10 hover:text-cyan-400"
          }`}
          title={
            orchestratorRunning
              ? "Orchestrator is running"
              : orchestratorSpawning
                ? "Starting..."
                : "Start Orchestrator"
          }
        >
          {orchestratorRunning ? (
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <title>Orchestrator running</title>
              <path d="M8 2v8M5 7l3 3 3-3M3 12h10M4 14h8" />
              <circle cx="13" cy="3" r="2.5" fill="currentColor" stroke="none" />
            </svg>
          ) : orchestratorSpawning ? (
            <svg
              className="h-4 w-4 animate-spin"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <title>Spawning...</title>
              <circle cx="8" cy="8" r="6" strokeDasharray="28" strokeDashoffset="8" />
            </svg>
          ) : (
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <title>Start Orchestrator</title>
              <path d="M8 2v8M5 7l3 3 3-3M3 12h10M4 14h8" />
            </svg>
          )}
        </button>
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
