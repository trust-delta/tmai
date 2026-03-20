import { useState, useCallback, useMemo } from "react";
import { useAgents } from "@/hooks/useAgents";
import { isAiAgent } from "@/lib/api";
import { AgentList } from "@/components/agent/AgentList";
import { AgentActions } from "@/components/agent/AgentActions";
import { StatusBar } from "@/components/layout/StatusBar";
import { TerminalPanel } from "@/components/terminal/TerminalPanel";
import { TerminalList } from "@/components/terminal/TerminalList";
import { SpawnBar } from "@/components/layout/SpawnBar";

export function App() {
  const { agents, attentionCount, loading, refresh } = useAgents();
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);

  // Split agents into AI agents and plain terminals
  const aiAgents = useMemo(
    () => agents.filter((a) => isAiAgent(a.agent_type)),
    [agents],
  );
  const terminals = useMemo(
    () => agents.filter((a) => !isAiAgent(a.agent_type)),
    [agents],
  );

  // Match by id (target may be missing from API response)
  const selectedAgent = agents.find(
    (a) => a.id === selectedTarget || a.target === selectedTarget,
  );
  const sessionId = selectedAgent?.pty_session_id ?? null;

  const handleSpawned = useCallback(
    (target: string) => {
      setSelectedTarget(target);
      refresh();
    },
    [refresh],
  );

  return (
    <div className="flex h-screen text-zinc-100">
      {/* Sidebar */}
      <aside className="glass flex w-80 shrink-0 flex-col">
        <StatusBar
          agentCount={aiAgents.length}
          attentionCount={attentionCount}
        />
        <AgentList
          agents={aiAgents}
          loading={loading}
          selectedTarget={selectedTarget}
          onSelect={setSelectedTarget}
        />
        <TerminalList
          terminals={terminals}
          selectedTarget={selectedTarget}
          onSelect={setSelectedTarget}
        />
        <SpawnBar onSpawned={handleSpawned} />
      </aside>

      {/* Main area */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {selectedAgent && <AgentActions agent={selectedAgent} />}
        {sessionId ? (
          <TerminalPanel key={sessionId} sessionId={sessionId} />
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <div className="glass-light rounded-2xl px-12 py-10 text-center">
              <h1 className="bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-3xl font-bold tracking-tight text-transparent">
                tmai
              </h1>
              <p className="mt-2 text-sm text-zinc-500">
                {agents.length > 0
                  ? "Select an agent to view terminal"
                  : "Spawn an agent to get started"}
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
