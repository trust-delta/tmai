interface StatusBarProps {
  agentCount: number;
  attentionCount: number;
}

// Top status bar with glassmorphism
export function StatusBar({ agentCount, attentionCount }: StatusBarProps) {
  return (
    <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
      <span className="bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-sm font-bold tracking-wide text-transparent">
        tmai
      </span>
      <div className="flex items-center gap-3 text-xs">
        <span className="text-zinc-500">{agentCount} agents</span>
        {attentionCount > 0 && (
          <span className="glow-amber rounded-full bg-amber-500/15 px-2.5 py-0.5 text-amber-400">
            {attentionCount} attention
          </span>
        )}
      </div>
    </div>
  );
}
