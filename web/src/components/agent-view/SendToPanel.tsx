import { useState } from "react";
import { useAgentsStore } from "../../stores/agents";
import { sendToAgent, getAgentOutput } from "../../api/client";
import type { Agent } from "../../types/agent";

interface SendToPanelProps {
  agent: Agent;
}

/** Panel for inter-agent communication: send text and view other agents' output */
export function SendToPanel({ agent }: SendToPanelProps) {
  const agents = useAgentsStore((s) => s.agents);
  const [targetId, setTargetId] = useState("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [viewOutput, setViewOutput] = useState<string | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);

  const otherAgents = agents.filter((a) => a.id !== agent.id);

  const handleSend = async () => {
    if (!targetId || !text.trim()) return;
    setError(null);
    setSuccess(null);
    setSending(true);
    try {
      await sendToAgent(agent.id, targetId, text);
      setSuccess(`Sent to ${otherAgents.find((a) => a.id === targetId)?.agent_type ?? targetId}`);
      setText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send");
    } finally {
      setSending(false);
    }
  };

  const handleViewOutput = async (id: string) => {
    setError(null);
    setViewingId(id);
    try {
      const result = await getAgentOutput(id);
      setViewOutput(result.output);
    } catch {
      // Not a PTY session — try to show last_content from the agent store
      setViewOutput("(No PTY output available for this agent)");
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-neutral-300 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-900/50">
      <div className="text-xs font-semibold text-neutral-600 dark:text-neutral-400">Agent Communication</div>

      {/* Send to another agent */}
      <div className="flex gap-2">
        <select
          value={targetId}
          onChange={(e) => setTargetId(e.target.value)}
          className="flex-shrink-0 rounded border border-neutral-300 bg-white px-2 py-1 text-xs focus:border-blue-500 focus:outline-none dark:border-neutral-600 dark:bg-neutral-800"
        >
          <option value="">Send to...</option>
          {otherAgents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.agent_type} ({a.id.slice(0, 8)})
            </option>
          ))}
        </select>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Text to send..."
          className="min-w-0 flex-1 rounded border border-neutral-300 bg-white px-2 py-1 text-xs focus:border-blue-500 focus:outline-none dark:border-neutral-600 dark:bg-neutral-800"
        />
        <button
          onClick={handleSend}
          disabled={sending || !targetId || !text.trim()}
          className="flex-shrink-0 rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          Send
        </button>
      </div>

      {/* View another agent's output */}
      <div className="flex gap-2">
        <select
          value={viewingId ?? ""}
          onChange={(e) => {
            const id = e.target.value;
            if (id) {
              handleViewOutput(id);
            } else {
              setViewOutput(null);
              setViewingId(null);
            }
          }}
          className="rounded border border-neutral-300 bg-white px-2 py-1 text-xs focus:border-blue-500 focus:outline-none dark:border-neutral-600 dark:bg-neutral-800"
        >
          <option value="">View output of...</option>
          {otherAgents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.agent_type} ({a.id.slice(0, 8)})
            </option>
          ))}
        </select>
        {viewingId && (
          <button
            onClick={() => handleViewOutput(viewingId)}
            className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-200 dark:border-neutral-600 dark:hover:bg-neutral-800"
          >
            Refresh
          </button>
        )}
      </div>

      {/* Status messages */}
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      {success && <p className="text-xs text-green-600 dark:text-green-400">{success}</p>}

      {/* Output viewer */}
      {viewOutput !== null && (
        <pre className="max-h-40 overflow-auto rounded border border-neutral-300 bg-neutral-100 p-2 text-xs text-neutral-700 dark:border-neutral-700 dark:bg-black/50 dark:text-neutral-300">
          {viewOutput || "(empty)"}
        </pre>
      )}
    </div>
  );
}
