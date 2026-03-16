/** Agent status variants matching Rust StatusInfo */
export type StatusInfo =
  | { type: "idle" }
  | { type: "processing"; message: string | null }
  | {
      type: "awaiting_approval";
      approval_type: string;
      details: string;
      choices: string[] | null;
      multi_select: boolean | null;
    }
  | { type: "error"; message: string }
  | { type: "offline" }
  | { type: "unknown" };

/** Team info associated with an agent */
export interface AgentTeamInfo {
  team_name: string;
  member_name: string;
  is_lead: boolean;
  current_task: { id: string; subject: string; status: string } | null;
}

/** Agent data from GET /api/agents and SSE agents event */
export interface Agent {
  id: string;
  agent_type: string;
  status: StatusInfo;
  cwd: string;
  session: string;
  window_name: string;
  needs_attention: boolean;
  is_virtual: boolean;
  team: AgentTeamInfo | null;
  mode: string;
  git_branch?: string;
  git_dirty?: boolean;
  is_worktree?: boolean;
  auto_approve_phase?: string;
  git_common_dir?: string;
  worktree_name?: string;
  /** PTY session ID if this agent was spawned via the spawn API */
  pty_session_id?: string;
}

/** Preview response from GET /api/agents/{id}/preview */
export interface PreviewResponse {
  content: string;
  lines: number;
}

/** Grouped agents by project (git_common_dir) */
export interface ProjectGroup {
  project: string;
  displayName: string;
  agents: Agent[];
}
