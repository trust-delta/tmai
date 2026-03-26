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
async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
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
export type AgentType =
  | "ClaudeCode"
  | "OpenCode"
  | "CodexCli"
  | "GeminiCli"
  | { Custom: string };
export type EffortLevel = "Low" | "Medium" | "High";

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
}

// ── Project grouping ──

// A worktree (or main) within a project, containing agents
export interface WorktreeGroup {
  name: string; // "main" or worktree name
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
export function groupByProject(
  agents: AgentSnapshot[],
  registeredProjects: string[] = [],
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
        branch: mainAgents[0]?.git_branch ?? null,
        isWorktree: false,
        dirty: mainAgents.some((a) => a.git_dirty === true),
        agents: mainAgents,
      });
    }

    // Remaining worktrees sorted by name
    const sortedEntries = [...worktreeMap.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    );
    for (const [name, wtAgents] of sortedEntries) {
      worktrees.push({
        name,
        branch: wtAgents[0]?.git_branch ?? null,
        isWorktree: true,
        dirty: wtAgents.some((a) => a.git_dirty === true),
        agents: wtAgents,
      });
    }

    const attentionCount = groupAgents.filter((a) =>
      needsAttention(a.status),
    ).length;

    const normRegistered = new Set(
      registeredProjects.map((p) => normalizeGitDir(p)),
    );

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

// Discriminated union for sidebar selection
export type Selection =
  | { type: "agent"; id: string }
  | { type: "worktree"; repoPath: string; name: string; worktreePath: string }
  | { type: "project"; path: string; name: string };

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
  last_fetch: number | null;
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
}

export interface PrInfo {
  number: number;
  title: string;
  state: string;
  head_branch: string;
  url: string;
  review_decision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  check_status: "SUCCESS" | "FAILURE" | "PENDING" | null;
  is_draft: boolean;
  additions: number;
  deletions: number;
}

export interface CiCheck {
  name: string;
  status: string;
  conclusion: string | null;
  url: string;
  started_at: string | null;
  completed_at: string | null;
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
}

export interface SpawnResponse {
  session_id: string;
  pid: number;
  command: string;
}

export interface AutoApproveSettings {
  mode: string;
  running: boolean;
}

export interface SpawnSettings {
  use_tmux_window: boolean;
  tmux_available: boolean;
  tmux_window_name: string;
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

// ── Security scan ──

export type SecuritySeverity = "Low" | "Medium" | "High" | "Critical";
export type SecurityCategory = "Permissions" | "McpServer" | "Environment" | "Hooks" | "FilePermissions";

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
  approve: (target: string) => apiFetch(`/agents/${target}/approve`, { method: "POST" }),
  selectChoice: (target: string, choice: number) =>
    apiFetch(`/agents/${target}/select`, {
      method: "POST",
      body: JSON.stringify({ choice }),
    }),
  submitSelection: (target: string, choices: number[]) =>
    apiFetch(`/agents/${target}/submit`, {
      method: "POST",
      body: JSON.stringify({ choices }),
    }),
  sendText: (target: string, text: string) =>
    apiFetch(`/agents/${target}/input`, {
      method: "POST",
      body: JSON.stringify({ text }),
    }),
  sendKey: (target: string, key: string) =>
    apiFetch(`/agents/${target}/key`, {
      method: "POST",
      body: JSON.stringify({ key }),
    }),
  killAgent: (target: string) =>
    apiFetch(`/agents/${target}/kill`, { method: "POST" }),
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
    apiFetch<{ content: string }>(`/agents/${encodeURIComponent(target)}/preview`),

  // Spawn
  spawnPty: (req: SpawnRequest) =>
    apiFetch<SpawnResponse>("/spawn", {
      method: "POST",
      body: JSON.stringify(req),
    }),
  spawnWorktree: (req: { name: string; cwd: string; base_branch?: string; rows?: number; cols?: number }) =>
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
  launchWorktreeAgent: (repoPath: string, worktreeName: string) =>
    apiFetch<{ status: string; target: string }>("/worktrees/launch", {
      method: "POST",
      body: JSON.stringify({ repo_path: repoPath, worktree_name: worktreeName }),
    }),
  deleteWorktree: (repoPath: string, worktreeName: string, force?: boolean) =>
    apiFetch("/worktrees/delete", {
      method: "POST",
      body: JSON.stringify({ repo_path: repoPath, worktree_name: worktreeName, force: force ?? false }),
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
  listPrs: (repoPath: string) =>
    apiFetch<Record<string, PrInfo>>(`/github/prs?repo=${encodeURIComponent(repoPath)}`),
  listChecks: (repoPath: string, branch: string) =>
    apiFetch<CiSummary>(`/github/checks?repo=${encodeURIComponent(repoPath)}&branch=${encodeURIComponent(branch)}`),
  listIssues: (repoPath: string) =>
    apiFetch<IssueInfo[]>(`/github/issues?repo=${encodeURIComponent(repoPath)}`),
  deleteBranch: (repoPath: string, branch: string, force?: boolean) =>
    apiFetch("/git/branches/delete", {
      method: "POST",
      body: JSON.stringify({ repo_path: repoPath, branch, force: force ?? false }),
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
  createWorktree: (repoPath: string, branchName: string, baseBranch?: string) =>
    apiFetch<{ status: string; path: string; branch: string }>("/worktrees", {
      method: "POST",
      body: JSON.stringify({ repo_path: repoPath, branch_name: branchName, base_branch: baseBranch }),
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

  // Security scan
  runSecurityScan: () =>
    apiFetch<ScanResult>("/security/scan", { method: "POST" }),
  lastSecurityScan: () =>
    apiFetch<ScanResult | null>("/security/last"),

  // Usage
  getUsage: () => apiFetch<UsageSnapshot>("/usage"),
  fetchUsage: () =>
    apiFetch("/usage/fetch", { method: "POST" }),
  getUsageSettings: () => apiFetch<UsageSettings>("/settings/usage"),
  updateUsageSettings: (params: Partial<UsageSettings>) =>
    apiFetch("/settings/usage", {
      method: "PUT",
      body: JSON.stringify(params),
    }),

  // Auto-approve settings
  getAutoApproveSettings: () =>
    apiFetch<AutoApproveSettings>("/settings/auto-approve"),
  updateAutoApproveMode: (mode: string) =>
    apiFetch("/settings/auto-approve", {
      method: "PUT",
      body: JSON.stringify({ mode }),
    }),

  // Spawn settings
  getSpawnSettings: () => apiFetch<SpawnSettings>("/settings/spawn"),
  updateSpawnSettings: (params: {
    use_tmux_window: boolean;
    tmux_window_name?: string;
  }) =>
    apiFetch("/settings/spawn", {
      method: "PUT",
      body: JSON.stringify(params),
    }),
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
    "review_launched",
    "review_completed",
    "usage",
    "worktree_created",
    "worktree_removed",
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
  const wsUrl = `${config.baseUrl.replace("http", "ws")}/api/agents/${agentId}/terminal?token=${config.token}`;
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
