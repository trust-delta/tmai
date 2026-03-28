// Enhanced API layer with Tauri IPC support for agents
// Falls back to HTTP for non-agent operations

import { tauri } from "./tauri";
import { api as httpApi } from "./api";
import type { AgentSnapshot } from "./api";

// Detect if running in Tauri environment
async function isTauriEnvironment(): Promise<boolean> {
  try {
    // Try to invoke a simple command to check if Tauri is available
    const { invoke } = await import("@tauri-apps/api/core");
    // If invoke is available, we're in Tauri
    return typeof invoke === "function";
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

export const api = {
  // Agent queries - use Tauri IPC if available
  listAgents: async (): Promise<AgentSnapshot[]> => {
    try {
      if (await isInTauri()) {
        return await tauri.listAgents();
      }
    } catch (e) {
      console.warn("Tauri invoke failed, falling back to HTTP", e);
    }
    return await httpApi.listAgents();
  },

  attentionCount: async (): Promise<number> => {
    try {
      if (await isInTauri()) {
        return await tauri.attentionCount();
      }
    } catch (e) {
      console.warn("Tauri invoke failed, falling back to HTTP", e);
    }
    return await httpApi.attentionCount();
  },

  // Agent actions - use Tauri IPC if available
  approve: async (target: string) => {
    try {
      if (await isInTauri()) {
        return await tauri.approveAgent(target);
      }
    } catch (e) {
      console.warn("Tauri invoke failed, falling back to HTTP", e);
    }
    return await httpApi.approve(target);
  },

  sendText: async (target: string, text: string) => {
    try {
      if (await isInTauri()) {
        return await tauri.sendText(target, text);
      }
    } catch (e) {
      console.warn("Tauri invoke failed, falling back to HTTP", e);
    }
    return await httpApi.sendText(target, text);
  },

  sendKey: async (target: string, key: string) => {
    try {
      if (await isInTauri()) {
        return await tauri.sendKey(target, key);
      }
    } catch (e) {
      console.warn("Tauri invoke failed, falling back to HTTP", e);
    }
    return await httpApi.sendKey(target, key);
  },

  // Proxy all other HTTP-based operations
  selectChoice: (target: string, choice: number) =>
    httpApi.selectChoice(target, choice),
  submitSelection: (target: string, choices: number[]) =>
    httpApi.submitSelection(target, choices),
  killAgent: (target: string) =>
    httpApi.killAgent(target),
  setAutoApprove: (target: string, enabled: boolean | null) =>
    httpApi.setAutoApprove(target, enabled),
  passthrough: (target: string, input: { chars?: string; key?: string }) =>
    httpApi.passthrough(target, input),
  getPreview: (target: string) =>
    httpApi.getPreview(target),

  // Spawn
  spawnPty: (req: any) =>
    httpApi.spawnPty(req),
  spawnWorktree: (req: any) =>
    httpApi.spawnWorktree(req),

  // Worktree management
  listWorktrees: () =>
    httpApi.listWorktrees(),
  getWorktreeDiff: (worktreePath: string, baseBranch?: string) =>
    httpApi.getWorktreeDiff(worktreePath, baseBranch),
  launchWorktreeAgent: (repoPath: string, worktreeName: string) =>
    httpApi.launchWorktreeAgent(repoPath, worktreeName),
  deleteWorktree: (repoPath: string, worktreeName: string, force?: boolean) =>
    httpApi.deleteWorktree(repoPath, worktreeName, force),

  // Git branches
  listBranches: (repoPath: string) =>
    httpApi.listBranches(repoPath),
  gitLog: (repoPath: string, base: string, branch: string) =>
    httpApi.gitLog(repoPath, base, branch),
  gitGraph: (repoPath: string, limit?: number) =>
    httpApi.gitGraph(repoPath, limit),
  listPrs: (repoPath: string) =>
    httpApi.listPrs(repoPath),
  listChecks: (repoPath: string, branch: string) =>
    httpApi.listChecks(repoPath, branch),
  listIssues: (repoPath: string) =>
    httpApi.listIssues(repoPath),
  deleteBranch: (repoPath: string, branch: string, force?: boolean) =>
    httpApi.deleteBranch(repoPath, branch, force),
  createBranch: (repoPath: string, name: string, base?: string) =>
    httpApi.createBranch(repoPath, name, base),
  checkoutBranch: (repoPath: string, branch: string) =>
    httpApi.checkoutBranch(repoPath, branch),
  gitFetch: (repoPath: string) =>
    httpApi.gitFetch(repoPath),
  gitPull: (repoPath: string) =>
    httpApi.gitPull(repoPath),
  gitMerge: (repoPath: string, branch: string) =>
    httpApi.gitMerge(repoPath, branch),

  // Directories
  listDirectories: (path?: string) =>
    httpApi.listDirectories(path),

  // Projects
  listProjects: () =>
    httpApi.listProjects(),
  addProject: (path: string) =>
    httpApi.addProject(path),
  removeProject: (path: string) =>
    httpApi.removeProject(path),

  // Security scan
  runSecurityScan: () =>
    httpApi.runSecurityScan(),
  lastSecurityScan: () =>
    httpApi.lastSecurityScan(),

  // Usage
  getUsage: () =>
    httpApi.getUsage(),
  fetchUsage: () =>
    httpApi.fetchUsage(),
  getUsageSettings: () =>
    httpApi.getUsageSettings(),
  updateUsageSettings: (params: any) =>
    httpApi.updateUsageSettings(params),

  // Auto-approve settings
  getAutoApproveSettings: () =>
    httpApi.getAutoApproveSettings(),
  updateAutoApproveMode: (mode: string) =>
    httpApi.updateAutoApproveMode(mode),
  updateAutoApproveRules: (rules: any) =>
    httpApi.updateAutoApproveRules(rules),

  // Files
  readFile: (path: string) =>
    httpApi.readFile(path),
  writeFile: (path: string, content: string) =>
    httpApi.writeFile(path, content),
  mdTree: (root: string) =>
    httpApi.mdTree(root),

  // Spawn settings
  getSpawnSettings: () =>
    httpApi.getSpawnSettings(),
  updateSpawnSettings: (params: any) =>
    httpApi.updateSpawnSettings(params),
};
