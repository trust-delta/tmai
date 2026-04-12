// HTTP/SSE/WebSocket API layer for tmai axum backend.
// Replaces Tauri IPC — all communication goes through the existing web API.

// ── Connection config ──

// Extract token from URL query params. Base URL is same origin (served by axum).
function getConfig(): { baseUrl: string; token: string } {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token") || "";
  const baseUrl = window.location.origin;
  return { baseUrl, token };
}

const config = getConfig();

// Authenticated fetch helper
async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${config.baseUrl}/api${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.token}`,
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json();
}

// ── Types ──

// Agent status (serde externally tagged)
export type AgentStatus =
  | "Idle"
  | "Offline"
  | "Unknown"
  | { Processing: { activity: string } }
  | { AwaitingApproval: { approval_type: string; details: string } }
  | { Error: { message: string } };

export function statusName(status: AgentStatus): string {
  if (typeof status === "string") return status;
  if (status == null) return "Unknown";
  // Externally tagged: { "Processing": { "activity": "..." } }
  const keys = Object.keys(status).filter((k) => k !== "type");
  if (keys.length > 0) return keys[0];
  // Internally tagged fallback: { "type": "Processing", ... }
  if ("type" in status && typeof (status as Record<string, unknown>).type === "string") {
    return (status as Record<string, unknown>).type as string;
  }
  return "Unknown";
}

export function needsAttention(status: AgentStatus): boolean {
  const name = statusName(status);
  return name === "AwaitingApproval" || name === "Error";
}

export type DetectionSource = "CapturePane" | "IpcSocket" | "HttpHook" | "WebSocket";
export type SendCapability = "Ipc" | "Tmux" | "PtyInject" | "None";

/// Which communication channels are currently available for this agent
export interface ConnectionChannels {
  has_tmux: boolean;
  has_ipc: boolean;
  has_hook: boolean;
  has_websocket: boolean;
  has_pty?: boolean;
}
export type AgentType = "ClaudeCode" | "OpenCode" | "CodexCli" | "GeminiCli" | { Custom: string };
export type EffortLevel = "Low" | "Medium" | "High";

/// Coarse-grained phase for orchestrator consumption
export type Phase = "Working" | "Blocked" | "Idle" | "Offline";

/// Fine-grained detail for UI display (serde externally tagged)
export type Detail =
  | "Idle"
  | "Offline"
  | "Unknown"
  | "Compacting"
  | "Thinking"
  | { ToolExecution: { tool_name: string } }
  | { AwaitingApproval: { approval_type: string; details: string } }
  | { Error: { message: string } };

/// Extract a human-readable label from a Detail value
export function detailLabel(detail: Detail): string {
  if (typeof detail === "string") return detail;
  if ("ToolExecution" in detail) return `Tool: ${detail.ToolExecution.tool_name}`;
  if ("AwaitingApproval" in detail) return `Awaiting: ${detail.AwaitingApproval.approval_type}`;
  if ("Error" in detail) return `Error: ${detail.Error.message}`;
  return "Unknown";
}

/// Whether this agent type is an AI coding agent (not a plain terminal)
export function isAiAgent(agentType: AgentType): boolean {
  return (
    agentType === "ClaudeCode" ||
    agentType === "OpenCode" ||
    agentType === "CodexCli" ||
    agentType === "GeminiCli"
  );
}

export interface AgentSnapshot {
  id: string;
  target: string;
  agent_type: AgentType;
  status: AgentStatus;
  phase: Phase;
  detail: Detail;
  title: string;
  cwd: string;
  display_cwd: string;
  display_name: string;
  detection_source: DetectionSource;
  git_branch: string | null;
  git_dirty: boolean | null;
  is_worktree: boolean | null;
  git_common_dir: string | null;
  worktree_name: string | null;
  worktree_base_branch: string | null;
  effort_level: EffortLevel | null;
  active_subagents: number;
  compaction_count: number;
  pty_session_id: string | null;
  send_capability: SendCapability;
  is_virtual: boolean;
  team_info: { team_name: string; member_name: string } | null;
  auto_approve_phase:
    | "Judging"
    | "ApprovedByRule"
    | "ApprovedByAi"
    | { ManualRequired: string }
    | null;
  auto_approve_override: boolean | null;
  auto_approve_effective: boolean;
  connection_channels?: ConnectionChannels;
  model_id?: string | null;
  model_display_name?: string | null;
  is_orchestrator?: boolean;
}

// ── Project grouping ──

// A worktree (or main) within a project, containing agents
export interface WorktreeGroup {
  name: string; // "main" or worktree name
  path: string; // filesystem path (for spawn cwd)
  branch: string | null;
  isWorktree: boolean;
  dirty: boolean;
  agents: AgentSnapshot[];
}

// A project group: one git repository (main + worktrees)
export interface ProjectGroup {
  // Display name derived from path (last dir component)
  name: string;
  // Full path (git_common_dir or cwd)
  path: string;
  // Worktrees within this project (main first, then worktrees sorted)
  worktrees: WorktreeGroup[];
  // Aggregate counts
  totalAgents: number;
  attentionAgents: number;
  // Whether this project was registered in config (vs auto-discovered)
  isRegistered: boolean;
}

// Derive project display name from path
function projectName(path: string): string {
  // "/home/user/works/tmai/.git" → "tmai"
  // "/home/user/works/tmai" → "tmai"
  const cleaned = path.replace(/\/\.git\/?$/, "");
  return cleaned.split("/").filter(Boolean).pop() || path;
}

// Normalize git_common_dir: strip trailing /.git and slashes
function normalizeGitDir(dir: string): string {
  return dir.replace(/\/\.git\/?$/, "").replace(/\/+$/, "");
}

// Group agents by project (git_common_dir) and worktree.
// Registered projects always appear even with 0 agents.
// When worktreeSnapshots is provided, agent-less worktrees are also shown.
export function groupByProject(
  agents: AgentSnapshot[],
  registeredProjects: string[] = [],
  worktreeSnapshots: WorktreeSnapshot[] = [],
): ProjectGroup[] {
  const projectMap = new Map<string, AgentSnapshot[]>();

  // First pass: build a cwd→git_common_dir lookup from agents that have it
  const cwdToGitDir = new Map<string, string>();
  for (const agent of agents) {
    if (agent.git_common_dir) {
      const norm = normalizeGitDir(agent.git_common_dir);
      cwdToGitDir.set(agent.cwd, norm);
    }
  }

  for (const agent of agents) {
    // Prefer git_common_dir, then lookup from cwd, then fallback to cwd itself
    let key: string;
    if (agent.git_common_dir) {
      key = normalizeGitDir(agent.git_common_dir);
    } else {
      // Try to match this cwd to a known git dir via prefix
      let matched = cwdToGitDir.get(agent.cwd);
      if (!matched) {
        for (const [cwd, gitDir] of cwdToGitDir) {
          if (agent.cwd.startsWith(cwd) || cwd.startsWith(agent.cwd)) {
            matched = gitDir;
            break;
          }
        }
      }
      key = matched || agent.cwd;
    }

    const group = projectMap.get(key);
    if (group) {
      group.push(agent);
    } else {
      projectMap.set(key, [agent]);
    }
  }

  const projects: ProjectGroup[] = [];

  for (const [path, groupAgents] of projectMap) {
    // Sub-group by worktree
    const worktreeMap = new Map<string, AgentSnapshot[]>();

    for (const agent of groupAgents) {
      const wtKey = agent.is_worktree
        ? agent.worktree_name || agent.git_branch || "worktree"
        : "main";
      const wt = worktreeMap.get(wtKey);
      if (wt) {
        wt.push(agent);
      } else {
        worktreeMap.set(wtKey, [agent]);
      }
    }

    // Build worktree groups (main first, then worktrees sorted)
    const worktrees: WorktreeGroup[] = [];
    const mainAgents = worktreeMap.get("main");
    if (mainAgents) {
      worktreeMap.delete("main");
      worktrees.push({
        name: "main",
        path,
        branch: mainAgents[0]?.git_branch ?? null,
        isWorktree: false,
        dirty: mainAgents.some((a) => a.git_dirty === true),
        agents: mainAgents,
      });
    }

    // Remaining worktrees sorted by name
    const sortedEntries = [...worktreeMap.entries()].sort(([a], [b]) => a.localeCompare(b));
    for (const [name, wtAgents] of sortedEntries) {
      // Find matching WorktreeSnapshot for path
      const snap = worktreeSnapshots.find(
        (ws) => normalizeGitDir(ws.repo_path) === path && ws.name === name,
      );
      worktrees.push({
        name,
        path: snap?.path ?? wtAgents[0]?.cwd ?? path,
        branch: wtAgents[0]?.git_branch ?? snap?.branch ?? null,
        isWorktree: true,
        dirty: wtAgents.some((a) => a.git_dirty === true),
        agents: wtAgents,
      });
    }

    // Add agent-less worktrees from snapshots
    const existingWtNames = new Set(worktrees.map((wt) => wt.name));
    const repoSnapshots = worktreeSnapshots.filter((ws) => normalizeGitDir(ws.repo_path) === path);
    // Ensure "main" group exists if we have snapshots for this repo
    if (!existingWtNames.has("main")) {
      const mainSnap = repoSnapshots.find((ws) => ws.is_main);
      if (mainSnap) {
        worktrees.unshift({
          name: "main",
          path,
          branch: mainSnap.branch,
          isWorktree: false,
          dirty: mainSnap.is_dirty ?? false,
          agents: [],
        });
        existingWtNames.add("main");
      }
    }
    for (const snap of repoSnapshots) {
      if (snap.is_main) continue;
      if (existingWtNames.has(snap.name)) continue;
      worktrees.push({
        name: snap.name,
        path: snap.path,
        branch: snap.branch,
        isWorktree: true,
        dirty: snap.is_dirty ?? false,
        agents: [],
      });
    }

    const attentionCount = groupAgents.filter((a) => needsAttention(a.status)).length;

    const normRegistered = new Set(registeredProjects.map((p) => normalizeGitDir(p)));

    projects.push({
      name: projectName(path),
      path,
      worktrees,
      totalAgents: groupAgents.length,
      attentionAgents: attentionCount,
      isRegistered: normRegistered.has(normalizeGitDir(path)),
    });
  }

  // Add registered projects that have no agents yet
  const existingPaths = new Set(projects.map((p) => normalizeGitDir(p.path)));
  for (const regPath of registeredProjects) {
    const norm = normalizeGitDir(regPath);
    if (!existingPaths.has(norm)) {
      projects.push({
        name: projectName(regPath),
        path: regPath,
        worktrees: [],
        totalAgents: 0,
        attentionAgents: 0,
        isRegistered: true,
      });
    }
  }

  // Sort: registered first, then by name (stable — no attention reordering)
  projects.sort((a, b) => {
    if (a.isRegistered && !b.isRegistered) return -1;
    if (!a.isRegistered && b.isRegistered) return 1;
    return a.name.localeCompare(b.name);
  });

  return projects;
}

// ── Worktree types ──

export interface WorktreeSnapshot {
  repo_name: string;
  repo_path: string;
  name: string;
  path: string;
  branch: string | null;
  is_main: boolean;
  agent_target: string | null;
  agent_status: string | null;
  is_dirty: boolean | null;
  diff_summary: { files_changed: number; insertions: number; deletions: number } | null;
}

export interface WorktreeDiffResponse {
  diff: string | null;
  summary: { files_changed: number; insertions: number; deletions: number } | null;
}

/// Transcript record from JSONL conversation log (discriminated union on `type`)
export type TranscriptRecord =
  | { type: "user"; text: string; uuid?: string; timestamp?: string }
  | { type: "assistant_text"; text: string; uuid?: string; timestamp?: string }
  | { type: "thinking"; text: string; uuid?: string; timestamp?: string }
  | {
      type: "tool_use";
      tool_name: string;
      input_summary: string;
      input_full?: Record<string, unknown>;
      uuid?: string;
      timestamp?: string;
    }
  | {
      type: "tool_result";
      output_summary: string;
      is_error?: boolean;
      uuid?: string;
      timestamp?: string;
    };

// Discriminated union for sidebar selection
export type Selection =
  | { type: "agent"; id: string }
  | { type: "worktree"; repoPath: string; name: string; worktreePath: string }
  | { type: "project"; path: string; name: string }
  | { type: "markdown"; projectPath: string; projectName: string };

export interface RemoteTrackingInfo {
  remote_branch: string;
  ahead: number;
  behind: number;
}

export interface BranchListResponse {
  default_branch: string;
  current_branch: string | null;
  branches: string[];
  parents: Record<string, string>;
  ahead_behind: Record<string, [number, number]>;
  remote_tracking: Record<string, RemoteTrackingInfo>;
  remote_only_branches: string[];
  last_fetch: number | null;
  last_commit_times: Record<string, number>;
}

export interface GraphCommit {
  sha: string;
  parents: string[];
  refs: string[];
  subject: string;
  authored_date: number;
}

export interface GraphData {
  commits: GraphCommit[];
  total_count: number;
}

export interface PrInfo {
  number: number;
  title: string;
  state: string;
  head_branch: string;
  head_sha: string;
  base_branch: string;
  url: string;
  review_decision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  check_status: "SUCCESS" | "FAILURE" | "PENDING" | null;
  is_draft: boolean;
  additions: number;
  deletions: number;
  comments: number;
  reviews: number;
  merge_commit_sha?: string;
}

export type CiRunStatus =
  | "queued"
  | "in_progress"
  | "completed"
  | "waiting"
  | "pending"
  | "requested"
  | "unknown";

export type CiConclusion =
  | "success"
  | "failure"
  | "neutral"
  | "skipped"
  | "cancelled"
  | "timed_out"
  | "action_required"
  | "unknown";

export interface CiCheck {
  name: string;
  status: CiRunStatus;
  conclusion: CiConclusion | null;
  url: string;
  started_at: string | null;
  completed_at: string | null;
  run_id: number | null;
}

export interface CiSummary {
  branch: string;
  checks: CiCheck[];
  rollup: "SUCCESS" | "FAILURE" | "PENDING" | "UNKNOWN";
}

export interface IssueLabel {
  name: string;
  color: string;
}

export interface IssueInfo {
  number: number;
  title: string;
  state: string;
  url: string;
  labels: IssueLabel[];
  assignees: string[];
}

export interface IssueComment {
  author: string;
  body: string;
  created_at: string;
  url: string;
}

export interface IssueDetail {
  number: number;
  title: string;
  state: string;
  url: string;
  body: string;
  labels: IssueLabel[];
  assignees: string[];
  created_at: string;
  updated_at: string;
  comments: IssueComment[];
}

export interface PrComment {
  author: string;
  body: string;
  created_at: string;
  url: string;
  comment_type: string;
  path: string | null;
  diff_hunk: string | null;
}

export interface PrChangedFile {
  path: string;
  additions: number;
  deletions: number;
}

export interface PrMergeStatus {
  mergeable: string;
  merge_state_status: string;
  review_decision: string | null;
  check_status: string | null;
}

export interface CiFailureLog {
  run_id: number;
  log_text: string;
}

export interface MdTreeEntry {
  name: string;
  path: string;
  is_dir: boolean;
  openable: boolean;
  children: MdTreeEntry[] | null;
}

export interface SpawnResponse {
  session_id: string;
  pid: number;
  command: string;
}

export interface AutoApproveRules {
  allow_read: boolean;
  allow_tests: boolean;
  allow_fetch: boolean;
  allow_git_readonly: boolean;
  allow_format_lint: boolean;
  allow_tmai_mcp: boolean;
  allow_patterns: string[];
}

export interface AutoApproveSettings {
  enabled: boolean;
  mode: string;
  running: boolean;
  rules: AutoApproveRules;
  provider: string;
  model: string;
  timeout_secs: number;
  cooldown_secs: number;
  check_interval_ms: number;
  allowed_types: string[];
  max_concurrent: number;
}

export interface SpawnSettings {
  use_tmux_window: boolean;
  tmux_available: boolean;
  tmux_window_name: string;
}

export interface OrchestratorRules {
  branch: string;
  merge: string;
  review: string;
  custom: string;
}

export interface NotifyTemplates {
  agent_stopped: string;
  agent_error: string;
  ci_passed: string;
  ci_failed: string;
  pr_created: string;
  pr_comment: string;
  rebase_conflict: string;
  pr_closed: string;
  guardrail_exceeded: string;
}

/** Tri-state handling per notification event: off / forward to orchestrator / auto-action. */
export type EventHandling = "off" | "notify" | "auto_action";

/** AutoAction prompt templates, sent directly to the target worker. */
export interface AutoActionTemplates {
  ci_failed_implementer: string;
  review_feedback_implementer: string;
}

export interface NotifySettings {
  on_agent_stopped: EventHandling;
  on_agent_error: EventHandling;
  on_rebase_conflict: EventHandling;
  on_ci_passed: EventHandling;
  on_ci_failed: EventHandling;
  on_pr_created: EventHandling;
  on_pr_comment: EventHandling;
  on_pr_closed: EventHandling;
  on_guardrail_exceeded: EventHandling;
  templates: NotifyTemplates;
  /** Built-in default templates (for UI placeholder display) */
  default_templates: NotifyTemplates;
}

export interface GuardrailsSettings {
  max_ci_retries: number;
  max_review_loops: number;
  escalate_to_human_after: number;
}

export interface OrchestratorSettings {
  enabled: boolean;
  role: string;
  rules: OrchestratorRules;
  notify: NotifySettings;
  guardrails: GuardrailsSettings;
  auto_action_templates: AutoActionTemplates;
  pr_monitor_enabled: boolean;
  pr_monitor_interval_secs: number;
  /** Whether this is a per-project override (true) or global fallback (false) */
  is_project_override: boolean;
}

export interface SpawnRequest {
  command: string;
  args?: string[];
  cwd?: string;
  rows?: number;
  cols?: number;
  force_pty?: boolean;
}

// ── Usage ──

export interface UsageMeter {
  label: string;
  percent: number;
  reset_info: string | null;
  spending: string | null;
}

export interface UsageSnapshot {
  meters: UsageMeter[];
  fetched_at: string | null;
  error: string | null;
}

export interface UsageSettings {
  enabled: boolean;
  auto_refresh_min: number;
}

export interface WorkflowSettings {
  auto_rebase_on_merge: boolean;
}

export interface WorktreeSettings {
  setup_commands: string[];
  setup_timeout_secs: number;
  branch_depth_warning: number;
}

export interface PreviewSettingsResponse {
  show_cursor: boolean;
  preview_poll_focused_ms: number;
  preview_poll_unfocused_ms: number;
  preview_poll_active_input_ms: number;
  preview_active_input_window_ms: number;
}

export interface PreviewSettingsUpdate {
  show_cursor?: boolean;
  preview_poll_focused_ms?: number;
  preview_poll_unfocused_ms?: number;
  preview_poll_active_input_ms?: number;
  preview_active_input_window_ms?: number;
}

// ── Security scan ──

export type SecuritySeverity = "Low" | "Medium" | "High" | "Critical";
export type SecurityCategory =
  | "Permissions"
  | "McpServer"
  | "Environment"
  | "Hooks"
  | "FilePermissions"
  | "CustomCommand"
  | "InstructionFile";

export interface SecurityRisk {
  rule_id: string;
  severity: SecuritySeverity;
  category: SecurityCategory;
  summary: string;
  detail: string;
  source: string;
  matched_value: string | null;
}

export interface ScanResult {
  risks: SecurityRisk[];
  scanned_at: string;
  scanned_projects: string[];
  files_scanned: number;
}

// ── Directory browser ──

export interface DirEntry {
  name: string;
  path: string;
  is_git: boolean;
}

// ── API wrappers ──

export const api = {
  // Agent queries
  listAgents: () => apiFetch<AgentSnapshot[]>("/agents"),
  attentionCount: async () => {
    const agents = await apiFetch<AgentSnapshot[]>("/agents");
    return agents.filter((a) => needsAttention(a.status)).length;
  },

  // Agent actions
  approve: (target: string) =>
    apiFetch(`/agents/${encodeURIComponent(target)}/approve`, { method: "POST" }),
  selectChoice: (target: string, choice: number) =>
    apiFetch(`/agents/${encodeURIComponent(target)}/select`, {
      method: "POST",
      body: JSON.stringify({ choice }),
    }),
  submitSelection: (target: string, choices: number[]) =>
    apiFetch(`/agents/${encodeURIComponent(target)}/submit`, {
      method: "POST",
      body: JSON.stringify({ choices }),
    }),
  sendText: (target: string, text: string) =>
    apiFetch(`/agents/${encodeURIComponent(target)}/input`, {
      method: "POST",
      body: JSON.stringify({ text }),
    }),
  sendPrompt: (target: string, prompt: string) =>
    apiFetch<{ status: string; action: string; queue_size: number }>(
      `/agents/${encodeURIComponent(target)}/prompt`,
      {
        method: "POST",
        body: JSON.stringify({ prompt }),
      },
    ),
  sendKey: (target: string, key: string) =>
    apiFetch(`/agents/${encodeURIComponent(target)}/key`, {
      method: "POST",
      body: JSON.stringify({ key }),
    }),
  killAgent: (target: string) =>
    apiFetch(`/agents/${encodeURIComponent(target)}/kill`, { method: "POST" }),
  setAutoApprove: (target: string, enabled: boolean | null) =>
    apiFetch(`/agents/${encodeURIComponent(target)}/auto-approve`, {
      method: "PUT",
      body: JSON.stringify({ enabled }),
    }),
  passthrough: (target: string, input: { chars?: string; key?: string }) =>
    apiFetch(`/agents/${encodeURIComponent(target)}/passthrough`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  getPreview: (target: string) =>
    apiFetch<{ content: string; cursor_x?: number; cursor_y?: number }>(
      `/agents/${encodeURIComponent(target)}/preview`,
    ),
  getTranscript: (target: string) =>
    apiFetch<{ records: TranscriptRecord[] }>(`/agents/${encodeURIComponent(target)}/transcript`),

  // Spawn
  spawnPty: (req: SpawnRequest) =>
    apiFetch<SpawnResponse>("/spawn", {
      method: "POST",
      body: JSON.stringify(req),
    }),
  spawnWorktree: (req: {
    name: string;
    cwd: string;
    base_branch?: string;
    initial_prompt?: string;
    rows?: number;
    cols?: number;
  }) =>
    apiFetch<SpawnResponse>("/spawn/worktree", {
      method: "POST",
      body: JSON.stringify(req),
    }),

  // Worktree management
  listWorktrees: () => apiFetch<WorktreeSnapshot[]>("/worktrees"),
  getWorktreeDiff: (worktreePath: string, baseBranch?: string) =>
    apiFetch<WorktreeDiffResponse>("/worktrees/diff", {
      method: "POST",
      body: JSON.stringify({ worktree_path: worktreePath, base_branch: baseBranch ?? "main" }),
    }),
  launchWorktreeAgent: (repoPath: string, worktreeName: string, initialPrompt?: string) =>
    apiFetch<{ status: string; target: string }>("/worktrees/launch", {
      method: "POST",
      body: JSON.stringify({
        repo_path: repoPath,
        worktree_name: worktreeName,
        ...(initialPrompt ? { initial_prompt: initialPrompt } : {}),
      }),
    }),
  deleteWorktree: (repoPath: string, worktreeName: string, force?: boolean) =>
    apiFetch("/worktrees/delete", {
      method: "POST",
      body: JSON.stringify({
        repo_path: repoPath,
        worktree_name: worktreeName,
        force: force ?? false,
      }),
    }),
  moveToWorktree: (repoPath: string, branchName: string, defaultBranch: string, dirName?: string) =>
    apiFetch<{ status: string; path: string; branch: string }>("/worktrees/move", {
      method: "POST",
      body: JSON.stringify({
        repo_path: repoPath,
        branch_name: branchName,
        default_branch: defaultBranch,
        ...(dirName ? { dir_name: dirName } : {}),
      }),
    }),

  // Git branches
  listBranches: (repoPath: string) =>
    apiFetch<BranchListResponse>(`/git/branches?repo=${encodeURIComponent(repoPath)}`),
  gitLog: (repoPath: string, base: string, branch: string) =>
    apiFetch<{ sha: string; subject: string; body: string }[]>(
      `/git/log?repo=${encodeURIComponent(repoPath)}&base=${encodeURIComponent(base)}&branch=${encodeURIComponent(branch)}`,
    ),
  gitGraph: (repoPath: string, limit?: number) =>
    apiFetch<GraphData>(
      `/git/graph?repo=${encodeURIComponent(repoPath)}${limit ? `&limit=${limit}` : ""}`,
    ),
  gitDiffStat: (repoPath: string, branch: string, base: string) =>
    apiFetch<{ files_changed: number; insertions: number; deletions: number } | null>(
      `/git/diff-stat?repo=${encodeURIComponent(repoPath)}&branch=${encodeURIComponent(branch)}&base=${encodeURIComponent(base)}`,
    ),
  gitBranchDiff: (repoPath: string, branch: string, base: string) =>
    apiFetch<WorktreeDiffResponse>(
      `/git/diff?repo=${encodeURIComponent(repoPath)}&branch=${encodeURIComponent(branch)}&base=${encodeURIComponent(base)}`,
    ),
  listPrs: (repoPath: string) =>
    apiFetch<Record<string, PrInfo>>(`/github/prs?repo=${encodeURIComponent(repoPath)}`),
  listChecks: (repoPath: string, branch: string) =>
    apiFetch<CiSummary>(
      `/github/checks?repo=${encodeURIComponent(repoPath)}&branch=${encodeURIComponent(branch)}`,
    ),
  listIssues: (repoPath: string) =>
    apiFetch<IssueInfo[]>(`/github/issues?repo=${encodeURIComponent(repoPath)}`),
  getIssueDetail: (repoPath: string, issueNumber: number) =>
    apiFetch<IssueDetail>(
      `/github/issue/detail?repo=${encodeURIComponent(repoPath)}&issue_number=${issueNumber}`,
    ),
  getPrComments: (repoPath: string, prNumber: number) =>
    apiFetch<PrComment[]>(
      `/github/pr/comments?repo=${encodeURIComponent(repoPath)}&pr_number=${prNumber}`,
    ),
  getPrFiles: (repoPath: string, prNumber: number) =>
    apiFetch<PrChangedFile[]>(
      `/github/pr/files?repo=${encodeURIComponent(repoPath)}&pr_number=${prNumber}`,
    ),
  getPrMergeStatus: (repoPath: string, prNumber: number) =>
    apiFetch<PrMergeStatus>(
      `/github/pr/merge-status?repo=${encodeURIComponent(repoPath)}&pr_number=${prNumber}`,
    ),
  getCiFailureLog: (repoPath: string, runId: number) =>
    apiFetch<CiFailureLog>(
      `/github/ci/failure-log?repo=${encodeURIComponent(repoPath)}&run_id=${runId}`,
    ),
  rerunFailedChecks: (repoPath: string, runId: number) =>
    apiFetch<{ status: string }>("/github/ci/rerun", {
      method: "POST",
      body: JSON.stringify({ repo: repoPath, run_id: runId }),
    }),
  deleteBranch: (repoPath: string, branch: string, force?: boolean, deleteRemote?: boolean) =>
    apiFetch("/git/branches/delete", {
      method: "POST",
      body: JSON.stringify({
        repo_path: repoPath,
        branch,
        force: force ?? false,
        delete_remote: deleteRemote ?? false,
      }),
    }),
  bulkDeleteBranches: (repoPath: string, branches: string[], deleteRemote?: boolean) =>
    apiFetch<{
      results: Array<{ branch: string; status: string; error?: string }>;
      succeeded: number;
      failed: number;
    }>("/git/branches/delete-bulk", {
      method: "POST",
      body: JSON.stringify({
        repo_path: repoPath,
        branches,
        delete_remote: deleteRemote ?? false,
      }),
    }),
  createBranch: (repoPath: string, name: string, base?: string) =>
    apiFetch("/git/branches/create", {
      method: "POST",
      body: JSON.stringify({ repo_path: repoPath, name, base }),
    }),
  checkoutBranch: (repoPath: string, branch: string) =>
    apiFetch("/git/checkout", {
      method: "POST",
      body: JSON.stringify({ repo_path: repoPath, branch }),
    }),
  gitFetch: (repoPath: string) =>
    apiFetch<{ status: string; output: string }>("/git/fetch", {
      method: "POST",
      body: JSON.stringify({ repo_path: repoPath }),
    }),
  gitPull: (repoPath: string) =>
    apiFetch<{ status: string; output: string }>("/git/pull", {
      method: "POST",
      body: JSON.stringify({ repo_path: repoPath }),
    }),
  gitMerge: (repoPath: string, branch: string) =>
    apiFetch<{ status: string; output: string }>("/git/merge", {
      method: "POST",
      body: JSON.stringify({ repo_path: repoPath, branch }),
    }),
  // Directories
  listDirectories: (path?: string) =>
    apiFetch<DirEntry[]>(`/directories${path ? `?path=${encodeURIComponent(path)}` : ""}`),

  // Projects
  listProjects: () => apiFetch<string[]>("/projects"),
  addProject: (path: string) =>
    apiFetch("/projects", {
      method: "POST",
      body: JSON.stringify({ path }),
    }),
  removeProject: (path: string) =>
    apiFetch("/projects/remove", {
      method: "POST",
      body: JSON.stringify({ path }),
    }),

  // Config audit
  runConfigAudit: () => apiFetch<ScanResult>("/config-audit/run", { method: "POST" }),
  lastConfigAudit: () => apiFetch<ScanResult | null>("/config-audit/last"),

  // Usage
  getUsage: () => apiFetch<UsageSnapshot>("/usage"),
  fetchUsage: () => apiFetch("/usage/fetch", { method: "POST" }),
  getUsageSettings: () => apiFetch<UsageSettings>("/settings/usage"),
  updateUsageSettings: (params: Partial<UsageSettings>) =>
    apiFetch("/settings/usage", {
      method: "PUT",
      body: JSON.stringify(params),
    }),

  // Auto-approve settings
  getAutoApproveSettings: () => apiFetch<AutoApproveSettings>("/settings/auto-approve"),
  updateAutoApproveMode: (mode: string) =>
    apiFetch("/settings/auto-approve", {
      method: "PUT",
      body: JSON.stringify({ mode }),
    }),
  updateAutoApproveRules: (rules: Partial<AutoApproveRules>) =>
    apiFetch("/settings/auto-approve", {
      method: "PUT",
      body: JSON.stringify({ rules }),
    }),
  updateAutoApproveFields: (
    fields: Partial<Omit<AutoApproveSettings, "running" | "rules" | "mode">>,
  ) =>
    apiFetch("/settings/auto-approve", {
      method: "PUT",
      body: JSON.stringify(fields),
    }),

  // Files
  readFile: (path: string) =>
    apiFetch<{ path: string; content: string; editable: boolean }>(
      `/files/read?path=${encodeURIComponent(path)}`,
    ),
  writeFile: (path: string, content: string) =>
    apiFetch("/files/write", {
      method: "POST",
      body: JSON.stringify({ path, content }),
    }),
  mdTree: (root: string) =>
    apiFetch<MdTreeEntry[]>(`/files/md-tree?root=${encodeURIComponent(root)}`),

  // Spawn settings
  getSpawnSettings: () => apiFetch<SpawnSettings>("/settings/spawn"),
  updateSpawnSettings: (params: { use_tmux_window: boolean; tmux_window_name?: string }) =>
    apiFetch("/settings/spawn", {
      method: "PUT",
      body: JSON.stringify(params),
    }),

  // Orchestrator settings (accepts optional project path for per-project scope)
  getOrchestratorSettings: (project?: string) =>
    apiFetch<OrchestratorSettings>(
      `/settings/orchestrator${project ? `?project=${encodeURIComponent(project)}` : ""}`,
    ),
  updateOrchestratorSettings: (
    params: {
      enabled?: boolean;
      role?: string;
      rules?: Partial<OrchestratorRules>;
      notify?: Partial<Omit<NotifySettings, "templates">> & {
        templates?: Partial<NotifyTemplates>;
      };
      guardrails?: Partial<GuardrailsSettings>;
      auto_action_templates?: Partial<AutoActionTemplates>;
      pr_monitor_enabled?: boolean;
      pr_monitor_interval_secs?: number;
    },
    project?: string,
  ) =>
    apiFetch(`/settings/orchestrator${project ? `?project=${encodeURIComponent(project)}` : ""}`, {
      method: "PUT",
      body: JSON.stringify(params),
    }),
  spawnOrchestrator: (params: { project: string; additional_instructions?: string }) =>
    apiFetch<SpawnResponse>("/orchestrator/spawn", {
      method: "POST",
      body: JSON.stringify(params),
    }),

  // Preview settings
  getPreviewSettings: () => apiFetch<PreviewSettingsResponse>("/settings/preview"),
  updatePreviewSettings: (params: PreviewSettingsUpdate) =>
    apiFetch("/settings/preview", {
      method: "PUT",
      body: JSON.stringify(params),
    }),

  // Notification settings
  getNotificationSettings: () =>
    apiFetch<{ notify_on_idle: boolean; notify_idle_threshold_secs: number }>(
      "/settings/notification",
    ),
  updateNotificationSettings: (params: {
    notify_on_idle?: boolean;
    notify_idle_threshold_secs?: number;
  }) =>
    apiFetch("/settings/notification", {
      method: "PUT",
      body: JSON.stringify(params),
    }),

  // Workflow settings
  getWorkflowSettings: () => apiFetch<WorkflowSettings>("/settings/workflow"),
  updateWorkflowSettings: (params: Partial<WorkflowSettings>) =>
    apiFetch("/settings/workflow", {
      method: "PUT",
      body: JSON.stringify(params),
    }),

  // Worktree settings
  getWorktreeSettings: () => apiFetch<WorktreeSettings>("/settings/worktree"),
  updateWorktreeSettings: (params: Partial<WorktreeSettings>) =>
    apiFetch("/settings/worktree", {
      method: "PUT",
      body: JSON.stringify(params),
    }),

  // Teams
  listTeams: () => apiFetch<import("./teams").TeamSummary[]>("/teams"),
  getTeamTasks: (teamName: string) =>
    apiFetch<import("./teams").TeamTaskInfo[]>(`/teams/${encodeURIComponent(teamName)}/tasks`),
};

// ── SSE event subscription ──

/// Subscribe to SSE named events from /api/events.
///
/// The axum backend sends named SSE events:
///   - "agents" — full AgentSnapshot[] payload
///   - "teams"  — full team info payload
///   - other named events (teammate_idle, task_completed, etc.)
///
/// EventSource.onmessage only fires for unnamed events, so we use
/// addEventListener for each named event type.
export function subscribeSSE(handlers: {
  onAgents?: (agents: AgentSnapshot[]) => void;
  onEvent?: (eventName: string, data: unknown) => void;
}): { unlisten: () => void } {
  const url = `${config.baseUrl}/api/events?token=${config.token}`;
  const es = new EventSource(url);

  // "agents" named event — full agent list
  es.addEventListener("agents", (e) => {
    try {
      const agents = JSON.parse(e.data) as AgentSnapshot[];
      handlers.onAgents?.(agents);
    } catch {
      // Ignore parse errors
    }
  });

  // Other named events — forward to generic handler
  const namedEvents = [
    "teams",
    "teammate_idle",
    "task_completed",
    "context_compacting",
    "usage",
    "worktree_created",
    "worktree_removed",
    "agent_stopped",
  ];
  for (const name of namedEvents) {
    es.addEventListener(name, (e) => {
      try {
        const data = JSON.parse(e.data);
        handlers.onEvent?.(name, data);
      } catch {
        // Ignore
      }
    });
  }

  es.onerror = () => {
    // EventSource auto-reconnects
  };

  return { unlisten: () => es.close() };
}

// ── WebSocket terminal ──

export function connectTerminal(
  agentId: string,
  onData: (data: Uint8Array) => void,
): { ws: WebSocket; send: (data: string | ArrayBuffer) => void } {
  const wsUrl = `${config.baseUrl.replace("http", "ws")}/api/agents/${encodeURIComponent(agentId)}/terminal?token=${config.token}`;
  const ws = new WebSocket(wsUrl);
  ws.binaryType = "arraybuffer";

  ws.onmessage = (e) => {
    if (e.data instanceof ArrayBuffer) {
      onData(new Uint8Array(e.data));
    } else if (typeof e.data === "string") {
      // Text frame — convert to bytes
      onData(new TextEncoder().encode(e.data));
    }
  };

  const send = (data: string | ArrayBuffer) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  };

  return { ws, send };
}
