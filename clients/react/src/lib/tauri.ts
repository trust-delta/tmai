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

// Convert Tauri AgentInfo to API AgentSnapshot.
//
// Step 6a (decision tmai-core@2026-05-07): the legacy `status` /
// `phase` / `detail` triple was retired from the wire surface. The
// Tauri bridge therefore drops the parser block — `info.status`
// continues to flow from the Tauri side (older Tauri builds may still
// emit it) but is not surfaced into the React snapshot. The new
// `attention` axis is left as `null` here because the Tauri bridge
// has no separate signal for it; downstream UI renders the bootstrap
// indeterminate badge until the SSE / HTTP path takes over.
function convertTauriAgent(info: TauriAgentInfo): AgentSnapshot {
  return {
    id: info.id,
    target: info.target,
    agent_type: info.type as AgentType,
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
