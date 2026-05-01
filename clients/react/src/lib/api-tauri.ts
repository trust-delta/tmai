// Enhanced API layer with Tauri IPC support for agents
// Re-exports all types from api-http.ts and provides Tauri-aware implementations

// Re-export everything from the HTTP API for types
export * from "./api-http";
export * from "./teams";

import type {
  AgentSnapshot,
  AutoActionTemplates,
  AutoApproveRules,
  AutoApproveSettings,
  GuardrailsSettings,
  NotifySettings,
  NotifyTemplates,
  OrchestratorRules,
  PrMonitorScope,
  SpawnRequest,
  UsageSettings,
  WorkerPermissionMode,
  WorkflowSettings,
  WorktreeSettings,
} from "./api-http";
import { api as httpApi } from "./api-http";
// Import for implementation
import { tauri } from "./tauri";
import type { TeamSummary, TeamTaskInfo } from "./teams";

// Detect if running in Tauri environment
async function isTauriEnvironment(): Promise<boolean> {
  try {
    // Try to import Tauri API to check if available
    await import("@tauri-apps/api/core");
    return true;
  } catch {
    return false;
  }
}

// Cached environment check
let tauriCheck: boolean | null = null;
async function isInTauri(): Promise<boolean> {
  if (tauriCheck === null) {
    tauriCheck = await isTauriEnvironment();
  }
  return tauriCheck;
}

// Create Tauri-aware API wrapper that overrides agent methods
export const api = {
  // Bootstrap — delegates to HTTP (no Tauri IPC equivalent)
  bootstrap: () => httpApi.bootstrap(),

  // Agent queries - use Tauri IPC if available
  listAgents: async (): Promise<AgentSnapshot[]> => {
    try {
      if (await isInTauri()) {
        return await tauri.listAgents();
      }
    } catch (_e) {}
    return await httpApi.listAgents();
  },

  attentionCount: async (): Promise<number> => {
    try {
      if (await isInTauri()) {
        return await tauri.attentionCount();
      }
    } catch (_e) {}
    return await httpApi.attentionCount();
  },

  // Agent actions - use Tauri IPC if available
  approve: async (target: string) => {
    try {
      if (await isInTauri()) {
        return await tauri.approveAgent(target);
      }
    } catch (_e) {}
    return await httpApi.approve(target);
  },

  sendText: async (target: string, text: string) => {
    try {
      if (await isInTauri()) {
        return await tauri.sendText(target, text);
      }
    } catch (_e) {}
    return await httpApi.sendText(target, text);
  },

  sendPrompt: (target: string, prompt: string) => httpApi.sendPrompt(target, prompt),

  sendKey: async (target: string, key: string) => {
    try {
      if (await isInTauri()) {
        return await tauri.sendKey(target, key);
      }
    } catch (_e) {}
    return await httpApi.sendKey(target, key);
  },

  // Proxy all other HTTP-based operations
  selectChoice: (target: string, choice: number) => httpApi.selectChoice(target, choice),
  submitSelection: (target: string, choices: number[]) => httpApi.submitSelection(target, choices),
  killAgent: (target: string) => httpApi.killAgent(target),
  subscribeTerminal: (target: string) => httpApi.subscribeTerminal(target),
  resizeAgentTerminal: (target: string, rows: number, cols: number) =>
    httpApi.resizeAgentTerminal(target, rows, cols),
  setAutoApprove: (target: string, enabled: boolean | null) =>
    httpApi.setAutoApprove(target, enabled),
  getTranscript: (target: string) => httpApi.getTranscript(target),
  getPromptQueue: (agentId: string) => httpApi.getPromptQueue(agentId),
  cancelQueuedPrompt: (agentId: string, promptId: string) =>
    httpApi.cancelQueuedPrompt(agentId, promptId),

  // Spawn
  spawnPty: (req: SpawnRequest) => httpApi.spawnPty(req),
  spawnWorktree: (req: {
    name: string;
    cwd: string;
    base_branch?: string;
    rows?: number;
    cols?: number;
  }) => httpApi.spawnWorktree(req),

  // Worktree management
  listWorktrees: () => httpApi.listWorktrees(),
  getWorktreeDiff: (worktreePath: string, baseBranch?: string) =>
    httpApi.getWorktreeDiff(worktreePath, baseBranch),
  launchWorktreeAgent: (repoPath: string, worktreeName: string, initialPrompt?: string) =>
    httpApi.launchWorktreeAgent(repoPath, worktreeName, initialPrompt),
  deleteWorktree: (repoPath: string, worktreeName: string, force?: boolean) =>
    httpApi.deleteWorktree(repoPath, worktreeName, force),
  moveToWorktree: (repoPath: string, branchName: string, defaultBranch: string, dirName?: string) =>
    httpApi.moveToWorktree(repoPath, branchName, defaultBranch, dirName),

  // Git branches
  listBranches: (repoPath: string) => httpApi.listBranches(repoPath),
  gitLog: (repoPath: string, base: string, branch: string) =>
    httpApi.gitLog(repoPath, base, branch),
  gitGraph: (repoPath: string, limit?: number) => httpApi.gitGraph(repoPath, limit),
  listPrs: (repoPath: string) => httpApi.listPrs(repoPath),
  listChecks: (repoPath: string, branch: string) => httpApi.listChecks(repoPath, branch),
  listIssues: (repoPath: string) => httpApi.listIssues(repoPath),
  getIssueDetail: (repoPath: string, issueNumber: number) =>
    httpApi.getIssueDetail(repoPath, issueNumber),
  getPrComments: (repoPath: string, prNumber: number) => httpApi.getPrComments(repoPath, prNumber),
  getPrFiles: (repoPath: string, prNumber: number) => httpApi.getPrFiles(repoPath, prNumber),
  getPrMergeStatus: (repoPath: string, prNumber: number) =>
    httpApi.getPrMergeStatus(repoPath, prNumber),
  getCiFailureLog: (repoPath: string, runId: number) => httpApi.getCiFailureLog(repoPath, runId),
  rerunFailedChecks: (repoPath: string, runId: number) =>
    httpApi.rerunFailedChecks(repoPath, runId),
  deleteBranch: (repoPath: string, branch: string, force?: boolean, deleteRemote?: boolean) =>
    httpApi.deleteBranch(repoPath, branch, force, deleteRemote),
  bulkDeleteBranches: (repoPath: string, branches: string[], deleteRemote?: boolean) =>
    httpApi.bulkDeleteBranches(repoPath, branches, deleteRemote),
  createBranch: (repoPath: string, name: string, base?: string) =>
    httpApi.createBranch(repoPath, name, base),
  checkoutBranch: (repoPath: string, branch: string) => httpApi.checkoutBranch(repoPath, branch),
  gitFetch: (repoPath: string) => httpApi.gitFetch(repoPath),
  gitPull: (repoPath: string) => httpApi.gitPull(repoPath),
  gitMerge: (repoPath: string, branch: string) => httpApi.gitMerge(repoPath, branch),
  gitDiffStat: (repoPath: string, branch: string, base: string) =>
    httpApi.gitDiffStat(repoPath, branch, base),
  gitBranchDiff: (repoPath: string, branch: string, base: string) =>
    httpApi.gitBranchDiff(repoPath, branch, base),

  // Directories
  listDirectories: (path?: string) => httpApi.listDirectories(path),

  // Projects
  listProjects: () => httpApi.listProjects(),
  addProject: (path: string) => httpApi.addProject(path),
  removeProject: (path: string) => httpApi.removeProject(path),

  // Config audit
  runConfigAudit: () => httpApi.runConfigAudit(),
  lastConfigAudit: () => httpApi.lastConfigAudit(),

  // Usage
  getUsage: () => httpApi.getUsage(),
  fetchUsage: () => httpApi.fetchUsage(),
  getUsageSettings: () => httpApi.getUsageSettings(),
  updateUsageSettings: (params: Partial<UsageSettings>) => httpApi.updateUsageSettings(params),

  // Auto-approve settings
  getAutoApproveSettings: () => httpApi.getAutoApproveSettings(),
  updateAutoApproveMode: (mode: string) => httpApi.updateAutoApproveMode(mode),
  updateAutoApproveRules: (rules: Partial<AutoApproveRules>) =>
    httpApi.updateAutoApproveRules(rules),
  updateAutoApproveFields: (
    fields: Partial<Omit<AutoApproveSettings, "running" | "rules" | "mode">>,
  ) => httpApi.updateAutoApproveFields(fields),

  // Files
  readFile: (path: string) => httpApi.readFile(path),
  writeFile: (path: string, content: string) => httpApi.writeFile(path, content),
  mdTree: (root: string) => httpApi.mdTree(root),

  // Spawn settings
  getSpawnSettings: () => httpApi.getSpawnSettings(),
  updateSpawnSettings: (params: {
    use_tmux_window: boolean;
    tmux_window_name?: string;
    worker_permission_mode?: WorkerPermissionMode;
  }) => httpApi.updateSpawnSettings(params),

  // Orchestrator settings (per-project scope via optional project param)
  getOrchestratorSettings: (project?: string) => httpApi.getOrchestratorSettings(project),
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
      pr_monitor_exclude_authors?: string[];
      pr_monitor_scope?: PrMonitorScope;
      inject_state_snapshot?: boolean;
    },
    project?: string,
  ) => httpApi.updateOrchestratorSettings(params, project),
  spawnOrchestrator: (params: { project: string; additional_instructions?: string }) =>
    httpApi.spawnOrchestrator(params),

  // Notification settings
  getNotificationSettings: () => httpApi.getNotificationSettings(),
  updateNotificationSettings: (params: {
    notify_on_idle?: boolean;
    notify_idle_threshold_secs?: number;
  }) => httpApi.updateNotificationSettings(params),

  // Workflow settings
  getWorkflowSettings: () => httpApi.getWorkflowSettings(),
  updateWorkflowSettings: (params: Partial<WorkflowSettings>) =>
    httpApi.updateWorkflowSettings(params),

  // Worktree settings
  getWorktreeSettings: () => httpApi.getWorktreeSettings(),
  updateWorktreeSettings: (params: Partial<WorktreeSettings>) =>
    httpApi.updateWorktreeSettings(params),

  // Teams (HTTP only for now)
  listTeams: (): Promise<TeamSummary[]> => httpApi.listTeams(),
  getTeamTasks: (teamName: string): Promise<TeamTaskInfo[]> => httpApi.getTeamTasks(teamName),

  // Scheduled kicks (Routines parity — #2)
  listScheduledKicks: () => httpApi.listScheduledKicks(),
  createScheduledKick: (kick: Parameters<typeof httpApi.createScheduledKick>[0]) =>
    httpApi.createScheduledKick(kick),
  updateScheduledKick: (id: string, updates: Parameters<typeof httpApi.updateScheduledKick>[1]) =>
    httpApi.updateScheduledKick(id, updates),
  deleteScheduledKick: (id: string) => httpApi.deleteScheduledKick(id),
  dryRunKick: (id: string) => httpApi.dryRunKick(id),
};
