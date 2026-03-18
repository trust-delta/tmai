import { useState, useCallback } from "react";
import { useAgents } from "@/hooks/useAgents";
import { AgentList } from "@/components/agent/AgentList";
import { AgentActions } from "@/components/agent/AgentActions";
import { StatusBar } from "@/components/layout/StatusBar";
import { TerminalPanel } from "@/components/terminal/TerminalPanel";
import { SpawnBar } from "@/components/layout/SpawnBar";

export function App() {
  const { agents, attentionCount, loading, refresh } = useAgents();
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);

  const selectedAgent = agents.find((a) => a.target === selectedTarget);
  const sessionId = selectedAgent?.pty_session_id ?? null;

  const handleSpawned = useCallback(
    (target: string) => {
      setSelectedTarget(target);
      refresh();
    },
    [refresh],
  );

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100">
      {/* Sidebar */}
      <aside className="flex w-80 shrink-0 flex-col border-r border-zinc-800">
        <StatusBar
          agentCount={agents.length}
          attentionCount={attentionCount}
        />
        <AgentList
          agents={agents}
          loading={loading}
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
            <div className="text-center">
              <h1 className="text-2xl font-bold tracking-tight text-zinc-300">
                tmai
              </h1>
              <p className="mt-1 text-sm text-zinc-600">
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
