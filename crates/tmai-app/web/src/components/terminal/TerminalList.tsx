import { type AgentSnapshot, statusName } from "@/lib/api";
import { cn } from "@/lib/utils";

interface TerminalListProps {
  terminals: AgentSnapshot[];
  selectedTarget: string | null;
  onSelect: (target: string) => void;
}

// Compact list of non-AI terminal sessions (bash, shell, etc.)
export function TerminalList({ terminals, selectedTarget, onSelect }: TerminalListProps) {
  if (terminals.length === 0) return null;

  return (
    <div className="border-t border-white/5 px-2 pb-2 pt-1">
      <div className="px-1 py-1 text-[10px] font-medium uppercase tracking-wider text-zinc-600">
        Terminals
      </div>
      <div className="flex flex-col gap-0.5">
        {terminals.map((t) => {
          const selected = t.id === selectedTarget || t.target === selectedTarget;
          const name = commandLabel(t);
          const status = statusName(t.status);
          return (
            <button
              type="button"
              key={t.id}
              onClick={() => onSelect(t.id)}
              className={cn(
                "flex items-center justify-between rounded-md px-2 py-1 text-left text-xs transition-colors",
                selected
                  ? "bg-cyan-500/10 text-cyan-400"
                  : "text-zinc-400 hover:bg-white/5 hover:text-zinc-300",
              )}
            >
              <div className="flex items-center gap-1.5 truncate">
                <span className="text-zinc-600">{">"}</span>
                <span className="truncate">{name}</span>
              </div>
              <span
                className={cn(
                  "shrink-0 text-[10px]",
                  status === "Idle" ? "text-zinc-600" : "text-zinc-500",
                )}
              >
                {status}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Derive a display label from the agent
function commandLabel(agent: AgentSnapshot): string {
  const type = agent.agent_type;
  const cmd = typeof type === "object" && "Custom" in type ? type.Custom : "";
  // Use display_name if informative, otherwise fall back to command name
  if (agent.display_name && agent.display_name !== "pty:0.0") {
    return agent.display_name;
  }
  return cmd || "terminal";
}
