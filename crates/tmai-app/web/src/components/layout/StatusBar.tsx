interface StatusBarProps {
  agentCount: number;
  attentionCount: number;
}

// Top status bar showing agent counts
export function StatusBar({ agentCount, attentionCount }: StatusBarProps) {
  return (
    <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2.5">
      <span className="text-sm font-semibold text-zinc-200">Agents</span>
      <div className="flex items-center gap-3 text-xs">
        <span className="text-zinc-500">{agentCount} total</span>
        {attentionCount > 0 && (
          <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-amber-400">
            {attentionCount} need attention
          </span>
        )}
      </div>
    </div>
  );
}
