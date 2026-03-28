// Tauri IPC layer for agent commands via invoke()
import { invoke } from "@tauri-apps/api/core";
import type { AgentSnapshot, AgentType, DetectionSource, EffortLevel } from "./api-http";

// Wrapper type for Tauri invoke responses (matches Rust AgentInfo)
interface TauriAgentInfo {
  id: string;
  target: string;
  type: string;
  status: string;
  title: string;
  cwd: string;
  display_cwd: string;
  detection_source: string;
  effort: string | null;
  git_branch: string | null;
  git_dirty: boolean | null;
  context_warning: number | null;
  is_virtual: boolean;
  mode: string;
  team_name: string | null;
}

// Convert Tauri AgentInfo to API AgentSnapshot
function convertTauriAgent(info: TauriAgentInfo): AgentSnapshot {
  // Parse status enum string from Tauri
  let status: AgentSnapshot["status"];
  if (info.status === "Idle") {
    status = "Idle";
  } else if (info.status === "Offline") {
    status = "Offline";
  } else if (info.status === "Unknown") {
    status = "Unknown";
  } else if (info.status.startsWith("Processing")) {
    status = { Processing: { activity: info.status.substring(11) } };
  } else if (info.status.startsWith("AwaitingApproval")) {
    status = { AwaitingApproval: { approval_type: "unknown", details: "" } };
  } else if (info.status.startsWith("Error")) {
    status = { Error: { message: info.status.substring(7) } };
  } else {
    status = "Unknown";
  }

  return {
    id: info.id,
    target: info.target,
    agent_type: info.type as AgentType,
    status,
    title: info.title,
    cwd: info.cwd,
    display_cwd: info.display_cwd,
    display_name: info.title,
    detection_source: info.detection_source as DetectionSource,
    git_branch: info.git_branch,
    git_dirty: info.git_dirty,
    is_worktree: null,
    git_common_dir: null,
    worktree_name: null,
    worktree_base_branch: null,
    effort_level: info.effort as EffortLevel | null,
    active_subagents: 0,
    compaction_count: 0,
    pty_session_id: null,
    send_capability: "None",
    is_virtual: info.is_virtual,
    team_info: info.team_name ? { team_name: info.team_name, member_name: "" } : null,
    auto_approve_phase: null,
    auto_approve_override: null,
  };
}

// Tauri IPC wrappers
export const tauri = {
  listAgents: async (): Promise<AgentSnapshot[]> => {
    const infos = await invoke<TauriAgentInfo[]>("list_agents");
    return infos.map(convertTauriAgent);
  },

  getAgent: async (target: string): Promise<AgentSnapshot> => {
    const info = await invoke<TauriAgentInfo>("get_agent", { target });
    return convertTauriAgent(info);
  },

  attentionCount: async (): Promise<number> => {
    return await invoke<number>("attention_count");
  },

  approveAgent: async (target: string): Promise<void> => {
    return await invoke<void>("approve_agent", { target });
  },

  sendText: async (target: string, text: string): Promise<void> => {
    return await invoke<void>("send_text", { target, text });
  },

  sendKey: async (target: string, key: string): Promise<void> => {
    return await invoke<void>("send_key", { target, key });
  },
};
