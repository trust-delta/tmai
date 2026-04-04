import { useAgentsStore } from "../../stores/agents";
import { useAgentPreview } from "../../hooks/useAgentPreview";
import { StatusBadge } from "../common/StatusBadge";
import { PreviewPane } from "./PreviewPane";
import { TerminalPane } from "./TerminalPane";
import { SendToPanel } from "./SendToPanel";
import { InputBar } from "./InputBar";
import { ApprovalBar } from "./ApprovalBar";
import type { Agent } from "../../types/agent";

interface AgentFullViewProps {
  agent: Agent;
}

export function AgentFullView({ agent }: AgentFullViewProps) {
  const selectAgent = useAgentsStore((s) => s.selectAgent);
  const preview = useAgentPreview(agent.id);

  return (
    <div className="flex h-full flex-col gap-3">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => selectAgent(null)}
          className="rounded px-2 py-1 text-sm hover:bg-neutral-200 dark:hover:bg-neutral-800"
        >
          ← Back
        </button>
        <span className="font-mono text-lg font-bold">{agent.agent_type}</span>
        <StatusBadge status={agent.status} />
        {agent.git_branch && (
          <span className="font-mono text-sm text-neutral-600 dark:text-neutral-400">
            {agent.git_branch}
            {agent.git_dirty ? " *" : ""}
          </span>
        )}
        {agent.team && (
          <span className="text-sm text-neutral-600 dark:text-neutral-500">
            {agent.team.team_name} · {agent.team.member_name}
          </span>
        )}
      </div>

      {/* Info row */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-600 dark:text-neutral-500">
        <span>ID: {agent.id}</span>
        <span>Session: {agent.session}</span>
        <span title={agent.cwd}>CWD: {agent.cwd}</span>
        {agent.mode && <span>Mode: {agent.mode}</span>}
        {agent.worktree_name && <span>Worktree: {agent.worktree_name}</span>}
      </div>

      {/* Approval bar (if awaiting) */}
      {agent.status.type === "awaiting_approval" && (
        <ApprovalBar agent={agent} />
      )}

      {/* Terminal or Preview pane */}
      <div className="min-h-0 flex-1">
        {agent.pty_session_id ? (
          <TerminalPane sessionId={agent.pty_session_id} />
        ) : (
          <PreviewPane preview={preview} />
        )}
      </div>

      {/* Inter-agent communication panel (shown when multiple agents exist) */}
      <SendToPanel agent={agent} />

      {/* Input bar (hidden when using xterm.js terminal — input goes directly to PTY) */}
      {!agent.pty_session_id && <InputBar agentId={agent.id} />}
    </div>
  );
}
