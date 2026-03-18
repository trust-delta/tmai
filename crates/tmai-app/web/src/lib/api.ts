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
  return Object.keys(status)[0];
}

export function needsAttention(status: AgentStatus): boolean {
  const name = statusName(status);
  return name === "AwaitingApproval" || name === "Error";
}

export type DetectionSource = "CapturePane" | "IpcSocket" | "HttpHook";
export type AgentType =
  | "ClaudeCode"
  | "OpenCode"
  | "CodexCli"
  | "GeminiCli"
  | { Custom: string };
export type EffortLevel = "Low" | "Medium" | "High";

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

export interface CoreEvent {
  type: string;
  target?: string;
  old_status?: string;
  new_status?: string;
  team_name?: string;
  member_name?: string;
}

export interface SpawnResponse {
  session_id: string;
  pid: number;
  command: string;
}

export interface SpawnRequest {
  command: string;
  args?: string[];
  cwd?: string;
  rows?: number;
  cols?: number;
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
    apiFetch(`/agents/${target}/key`, {
      method: "POST",
      body: JSON.stringify({ key: "C-c" }),
    }),

  // Spawn
  spawnPty: (req: SpawnRequest) =>
    apiFetch<SpawnResponse>("/spawn", {
      method: "POST",
      body: JSON.stringify(req),
    }),
};

// ── SSE event subscription ──

export function onCoreEvent(
  cb: (event: CoreEvent) => void,
): { unlisten: () => void } {
  const url = `${config.baseUrl}/api/events?token=${config.token}`;
  const es = new EventSource(url);

  es.onmessage = (e) => {
    try {
      const event = JSON.parse(e.data) as CoreEvent;
      cb(event);
    } catch {
      // SSE may send non-JSON keepalive
    }
  };

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
