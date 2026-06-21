// Enhanced API layer with Tauri IPC support for agents
// Re-exports all types from api-http.ts and provides Tauri-aware implementations

// Re-export everything from the HTTP API for types
export * from "./api-http";
export * from "./teams";

import type {
  AgentSnapshot,
  AimCreateRequest,
  AimEditRequest,
  AttentionSetRequest,
  DispatchBundle,
  OrchestratorRules,
  PrMergeMethod,
  PrMergeOverride,
  PrMonitorScope,
  SlackCaptureRequest,
  SpawnRequest,
  SpawnRuntime,
  TriggerHandoffRitualRequest,
  WorkerDispatchMap,
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
  launchProducer: (unit: string) => httpApi.launchProducer(unit),

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
  getIssueDetail: (repoPath: string, issueNumber: number) =>
    httpApi.getIssueDetail(repoPath, issueNumber),
  getPrComments: (repoPath: string, prNumber: number) => httpApi.getPrComments(repoPath, prNumber),
  // R₂ in-tmai PR viewer (#749) — HTTP only, gh-CLI passthrough.
  prBody: (repoPath: string, prNumber: number) => httpApi.prBody(repoPath, prNumber),
  prLabels: (repoPath: string, prNumber: number) => httpApi.prLabels(repoPath, prNumber),
  getPrFiles: (repoPath: string, prNumber: number) => httpApi.getPrFiles(repoPath, prNumber),
  getPrMergeStatus: (repoPath: string, prNumber: number) =>
    httpApi.getPrMergeStatus(repoPath, prNumber),
  // Stage-1 in-tmai dev-loop (HTTP only — gh-CLI passthrough, no
  // Tauri-specific path needed)
  prDiff: (repoPath: string, prNumber: number) => httpApi.prDiff(repoPath, prNumber),
  mergePr: (
    repoPath: string,
    prNumber: number,
    opts?: { method?: PrMergeMethod; deleteBranch?: boolean; override?: PrMergeOverride },
  ) => httpApi.mergePr(repoPath, prNumber, opts),
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

  // General settings
  getGeneralSettings: () => httpApi.getGeneralSettings(),
  updateGeneralSettings: (params: { default_project_root?: string | null }) =>
    httpApi.updateGeneralSettings(params),

  // Files
  readFile: (path: string) => httpApi.readFile(path),
  writeFile: (path: string, content: string) => httpApi.writeFile(path, content),
  mdTree: (root: string) => httpApi.mdTree(root),

  // Spawn settings
  getSpawnSettings: () => httpApi.getSpawnSettings(),
  updateSpawnSettings: (params: { runtime: SpawnRuntime; tmux_window_name?: string }) =>
    httpApi.updateSpawnSettings(params),

  // Orchestrator settings (per-project scope via optional project param)
  getOrchestratorSettings: (project?: string) => httpApi.getOrchestratorSettings(project),
  updateOrchestratorSettings: (
    params: {
      enabled?: boolean;
      role?: string;
      rules?: Partial<OrchestratorRules>;
      pr_monitor_enabled?: boolean;
      pr_monitor_interval_secs?: number;
      pr_monitor_exclude_authors?: string[];
      pr_monitor_scope?: PrMonitorScope;
      inject_state_snapshot?: boolean;
      auto_handoff_threshold_pct?: number;
      /** Tri-state: omit → unchanged. `null` → clear. Object → replace. */
      orchestrator?: DispatchBundle | null;
      /** Replaces the entire `[orchestration.dispatch]` table. */
      dispatch?: WorkerDispatchMap;
    },
    project?: string,
  ) => httpApi.updateOrchestratorSettings(params, project),

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

  // Calibration view (HTTP only — read-only window into the file-backed
  // calibration store; no Tauri-specific path needed)
  calibration: (unit: string, days?: number) => httpApi.calibration(unit, days),

  // Decisions view (HTTP only — on-demand JSON projection of compose()'s
  // Settled section; no Tauri-specific path needed)
  decisions: (unit: string) => httpApi.decisions(unit),

  // Active approaches view (HTTP only — on-demand JSON projection of
  // compose()'s ▣ section; no Tauri-specific path needed)
  approaches: (unit: string) => httpApi.approaches(unit),

  // Observations view (HTTP only — on-demand JSON projection of the unit's
  // doc/observations/ records; no Tauri-specific path needed)
  observations: (unit: string) => httpApi.observations(unit),

  // Aims view (HTTP only — on-demand JSON projection of the unit's
  // doc/aims/ records; no Tauri-specific path needed)
  aims: (unit: string) => httpApi.aims(unit),

  // Aim-tree write surface (tmai-core #501; HTTP only — file-backed
  // doc/aims/ records served over the web API, no Tauri-specific path needed)
  createAim: (unit: string, body: AimCreateRequest) => httpApi.createAim(unit, body),
  editAim: (unit: string, slug: string, body: AimEditRequest) => httpApi.editAim(unit, slug, body),

  // Unit-scoped cross-repo PR list (HTTP only — gh-CLI passthrough
  // fanned out over the unit's repos; no Tauri-specific path needed)
  unitPrs: (unit: string) => httpApi.unitPrs(unit),

  // Unit-scoped cross-repo issue list — the issues peer of `unitPrs`
  // (HTTP only — gh-CLI passthrough fanned out over the unit's repos)
  unitIssues: (unit: string) => httpApi.unitIssues(unit),

  // Unit-scoped slack-ore terrain + operator capture (HTTP only — file-backed
  // doc/slack/ records served over the web API; no Tauri-specific path needed)
  unitSlack: (unit: string) => httpApi.unitSlack(unit),
  captureSlack: (unit: string, body: SlackCaptureRequest) => httpApi.captureSlack(unit, body),

  // Unit-scoped cross-record in-play inventory (HTTP only — on-demand JSON
  // projection of the unit's decisions + serving approaches; no
  // Tauri-specific path needed)
  unitInventory: (unit: string) => httpApi.unitInventory(unit),

  // Per-artifact attention map + operator write (HTTP only — file-backed
  // attention store served over the web API; no Tauri-specific path needed)
  unitAttention: (unit: string) => httpApi.unitAttention(unit),
  setUnitAttention: (unit: string, body: AttentionSetRequest) =>
    httpApi.setUnitAttention(unit, body),

  // Configured-unit membership view (HTTP only — membership-only,
  // no live agent state joined server-side; no Tauri-specific path needed)
  units: () => httpApi.units(),
  unit: (name: string) => httpApi.unit(name),

  // Working-with-human view (HTTP only — on-demand JSON projection of
  // compose()'s ◐ section; no Tauri-specific path needed)
  workingWithHuman: (unit: string) => httpApi.workingWithHuman(unit),

  // Hand-over batons (HTTP only — read-only file-backed baton store, the
  // operator-side half of tmai-core #473; no Tauri-specific path needed)
  unitHandoffs: (unit: string) => httpApi.unitHandoffs(unit),
  unitHandoff: (unit: string, name: string) => httpApi.unitHandoff(unit, name),

  // Handoff-and-restart ritual (HTTP only — server-driven multi-step
  // ritual emits its own SSE phase events; no Tauri IPC equivalent).
  triggerHandoffRitual: (unit: string, body: TriggerHandoffRitualRequest) =>
    httpApi.triggerHandoffRitual(unit, body),

  // Producer-slot close (HTTP only — engine kills the Producer + dispatched
  // workers and stops the respawn supervisor; no Tauri IPC equivalent).
  closeUnit: (unit: string) => httpApi.closeUnit(unit),

  // Operator review-gate decisions (#547 / tmai-core #549; HTTP only —
  // server-driven ritual that emits its own SSE phase events, like
  // triggerHandoffRitual; no Tauri IPC equivalent).
  approveHandoff: (unit: string, ritualId: string) => httpApi.approveHandoff(unit, ritualId),
  requestHandoffRewrite: (unit: string, ritualId: string, feedback: string) =>
    httpApi.requestHandoffRewrite(unit, ritualId, feedback),
};
