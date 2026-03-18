import { invoke, Channel } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// Agent status matching Rust AgentStatus enum (serde adjacently tagged)
// Simple variants: "Idle", "Offline", "Unknown"
// Object variants: { Processing: { activity } }, { AwaitingApproval: { ... } }, { Error: { message } }
export type AgentStatus =
  | "Idle"
  | "Offline"
  | "Unknown"
  | { Processing: { activity: string } }
  | { AwaitingApproval: { approval_type: string; details: string } }
  | { Error: { message: string } };

// Helper to extract the status name string from AgentStatus
export function statusName(status: AgentStatus): string {
  if (typeof status === "string") return status;
  return Object.keys(status)[0];
}

// Helper to check if agent needs attention
export function needsAttention(status: AgentStatus): boolean {
  const name = statusName(status);
  return name === "AwaitingApproval" || name === "Error";
}

// Detection source matching Rust DetectionSource enum
export type DetectionSource = "CapturePane" | "IpcSocket" | "HttpHook";

// Agent type matching Rust AgentType enum
export type AgentType =
  | "ClaudeCode"
  | "OpenCode"
  | "CodexCli"
  | "GeminiCli"
  | { Custom: string };

// Effort level
export type EffortLevel = "Low" | "Medium" | "High";

// Minimal AgentSnapshot mirroring Rust struct (key display fields)
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
  effort_level: EffortLevel | null;
  active_subagents: number;
  compaction_count: number;
  pty_session_id: string | null;
  is_virtual: boolean;
  team_info: { team_name: string; member_name: string } | null;
}

// CoreEvent matching Rust tagged enum (serde tag = "type")
export interface CoreEvent {
  type: string;
  target?: string;
  old_status?: string;
  new_status?: string;
  team_name?: string;
  member_name?: string;
}

// Spawn response
export interface SpawnResponse {
  sessionId: string;
  pid: number;
  command: string;
}

// Spawn request
export interface SpawnRequest {
  command: string;
  args?: string[];
  cwd?: string;
  rows?: number;
  cols?: number;
}

// Typed API wrappers
export const api = {
  // Agent queries
  listAgents: () => invoke<AgentSnapshot[]>("list_agents"),
  getAgent: (target: string) => invoke<AgentSnapshot>("get_agent", { target }),
  attentionCount: () => invoke<number>("attention_count"),

  // Agent actions
  approve: (target: string) => invoke("approve", { target }),
  selectChoice: (target: string, choice: number) =>
    invoke("select_choice", { target, choice }),
  submitSelection: (target: string, choices: number[]) =>
    invoke("submit_selection", { target, choices }),
  sendText: (target: string, text: string) =>
    invoke("send_text", { target, text }),
  sendKey: (target: string, key: string) =>
    invoke("send_key", { target, key }),
  killAgent: (target: string) => invoke("kill_agent", { target }),

  // Terminal (PTY) operations
  spawnPty: (req: SpawnRequest) => invoke<SpawnResponse>("spawn_pty", { req }),
  writePty: (sessionId: string, data: number[]) =>
    invoke("write_pty", { sessionId, data }),
  resizePty: (sessionId: string, rows: number, cols: number) =>
    invoke("resize_pty", { sessionId, rows, cols }),
  killPty: (sessionId: string) => invoke("kill_pty", { sessionId }),

  // Subscribe to PTY output via Tauri Channel
  subscribePty: (sessionId: string, onData: Channel<number[]>) =>
    invoke("subscribe_pty", { sessionId, onData }),
};

// Subscribe to CoreEvents from Rust backend
export function onCoreEvent(
  cb: (event: CoreEvent) => void,
): Promise<UnlistenFn> {
  return listen<CoreEvent>("core-event", (e) => cb(e.payload));
}
