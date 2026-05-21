// HTTP/SSE/WebSocket API layer for tmai axum backend.
// Replaces Tauri IPC — all communication goes through the existing web API.

import type { AgentCtxUsage } from "@/types/generated/AgentCtxUsage";
import type { BootstrapRequiredEvent } from "@/types/generated/BootstrapRequiredEvent";
import type { CalibrationCellWire } from "@/types/generated/CalibrationCellWire";
import type { CalibrationEntry } from "@/types/generated/CalibrationEntry";
import type { CalibrationResponse } from "@/types/generated/CalibrationResponse";
import type { Confidence } from "@/types/generated/Confidence";
import type { DispatchBundle } from "@/types/generated/DispatchBundle";
import type { DispatchSnapshot } from "@/types/generated/DispatchSnapshot";
import type { EntityUpdateEnvelope } from "@/types/generated/EntityUpdateEnvelope";
import type { HandoffRitualEvent } from "@/types/generated/HandoffRitualEvent";
import type { Outcome } from "@/types/generated/Outcome";
import type { PermissionMode } from "@/types/generated/PermissionMode";
import type { PrDiffResponse } from "@/types/generated/PrDiffResponse";
import type { PrSummaryWire } from "@/types/generated/PrSummaryWire";
import type { QueueAgentEntry } from "@/types/generated/QueueAgentEntry";
import type { QueueSnapshot } from "@/types/generated/QueueSnapshot";
import type { RepoPrsWire } from "@/types/generated/RepoPrsWire";
import type { RuntimeSnapshot } from "@/types/generated/RuntimeSnapshot";
import type { SpawnRole } from "@/types/generated/SpawnRole";
import type { SpawnRuntime } from "@/types/generated/SpawnRuntime";
import type { TeamSnapshot } from "@/types/generated/TeamSnapshot";
import type { TerminalSubscription } from "@/types/generated/TerminalSubscription";
import type { TriageVerdict } from "@/types/generated/TriageVerdict";
import type { UnitPrsResponse } from "@/types/generated/UnitPrsResponse";
import type { Vendor } from "@/types/generated/Vendor";
import type { WorkerDispatchMap } from "@/types/generated/WorkerDispatchMap";
import type { WorkflowSnapshot } from "@/types/generated/WorkflowSnapshot";

export type {
  AgentCtxUsage,
  BootstrapRequiredEvent,
  CalibrationCellWire,
  CalibrationEntry,
  CalibrationResponse,
  Confidence,
  DispatchBundle,
  EntityUpdateEnvelope,
  HandoffRitualEvent,
  Outcome,
  PermissionMode,
  PrDiffResponse,
  PrSummaryWire,
  QueueAgentEntry,
  QueueSnapshot,
  RepoPrsWire,
  SpawnRole,
  SpawnRuntime,
  TerminalSubscription,
  TriageVerdict,
  UnitPrsResponse,
  Vendor,
  WorkerDispatchMap,
};

// ── Connection config ──

// Extract token from URL query params. Base URL is same origin (served by axum).
function getConfig(): { baseUrl: string; token: string } {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token") || "";
  const baseUrl = window.location.origin;
  return { baseUrl, token };
}

const config = getConfig();

// Updated by setCallerCwd() in App.tsx whenever the selected project changes.
// Injected into X-Tmai-Origin on state-changing requests so the orchestrator
// can resolve the source project for fail-closed notification scoping.
let callerCwd: string | null = null;

export function setCallerCwd(cwd: string | null): void {
  callerCwd = cwd;
}

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Authenticated fetch helper
async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${config.baseUrl}/api${path}`;
  const method = (options.method ?? "GET").toUpperCase();
  const originHeaders: Record<string, string> = {};
  if (STATE_CHANGING_METHODS.has(method)) {
    const origin: { kind: "Human"; interface: string; cwd?: string } = {
      kind: "Human",
      interface: "webui",
      ...(callerCwd !== null ? { cwd: callerCwd } : {}),
    };
    originHeaders["X-Tmai-Origin"] = JSON.stringify(origin);
  }
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.token}`,
      ...options.headers,
      // X-Tmai-Origin is authoritative for fail-closed scope; spread LAST
      // so callers cannot override it via options.headers.
      ...originHeaders,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json();
}

// ── Types ──

// Step 6a (decision tmai-core@2026-05-07): the legacy `AgentStatus`
// shim, the matching `statusName` helper, and the `Phase` / `Detail`
// types are retired alongside the wire fields. Only the new
// `AgentAttention` axis below survives. Use
// `attention?.required` + `attention?.reason` to drive UI semantics
// (see `AgentCard.tsx::attentionPill`).

export type DetectionSource = "CapturePane" | "IpcSocket" | "HttpHook" | "WebSocket";
export type SendCapability = "Ipc" | "Tmux" | "PtyInject" | "None";

// ── Attention axis (decision tmai-core@2026-05-09 Phase 4) ──
//
// Three variants represent the user-blocked states; `null` / absent
// means "running normally — no UI signal needed". Hint-only for UI
// consumers; the discriminant must never drive Core / PTY-server / Hub
// logic (decision §3 wire contract).
//
// - `"started"`   — just spawned, awaiting first user prompt
// - `"halted"`    — at a permission/selection prompt; user must answer
// - `"completed"` — turn finished; user must decide what to do next
export type AgentAttention = "started" | "halted" | "completed";

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

// Phase / Detail / detailLabel retired in Step 6a (decision
// tmai-core@2026-05-07) alongside the AgentStatus pentad. Use the
// `AgentAttention` axis above for dynamic state.

/// Whether this agent type is an AI coding agent (not a plain terminal)
export function isAiAgent(agentType: AgentType): boolean {
  return (
    agentType === "ClaudeCode" ||
    agentType === "OpenCode" ||
    agentType === "CodexCli" ||
    agentType === "GeminiCli"
  );
}

/// Canonical AgentId schemes that mark a snapshot as an AI coding agent
/// regardless of `agent_type`. Post-2026-05-09 detection canonicalization,
/// `id` carries the canonical scheme (`claude:` / `codex:` / `gemini:` /
/// `opencode:`) even when the spawn command was wrapped — e.g. the
/// Producer launch wraps `tmai producer <unit>` under `bash -c` to
/// satisfy tmai-core's `/api/spawn` allow-list (see
/// `doc/decisions/2026-05-14-react-producer-console-rebuild.md` polish v4).
/// In that wrapped case `agent_type` stays `Custom("bash")` and the
/// plain `isAiAgent(agent_type)` check misses the Producer.
///
/// TODO(tmai-core spawn-allow-list): when tmai-core's allow-list adds
/// `tmai` as a first-class command, the bash wrap goes away and
/// `agent_type` reflects reality — this id-scheme fallback can retire.
const AI_ID_SCHEMES = ["claude:", "codex:", "gemini:", "opencode:"] as const;

/// True if the agent is an AI coding agent — either by `agent_type` or
/// (post-2026-05-09 fallback) by canonical AgentId scheme prefix.
///
/// Centralized here so the bash-wrapped Producer case (#676) classifies
/// consistently across the WebUI: hand-over digest, App's `aiAgents` →
/// `projectPaths` derivation, sidebar AI/terminal split, etc.
export function isAiAgentLoose(agent: { id: string; agent_type: AgentType }): boolean {
  if (isAiAgent(agent.agent_type)) return true;
  return AI_ID_SCHEMES.some((scheme) => agent.id.startsWith(scheme));
}

export interface AgentSnapshot {
  id: string;
  target: string;
  agent_type: AgentType;
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
  connection_channels?: ConnectionChannels;
  model_id?: string | null;
  model_display_name?: string | null;
  is_orchestrator?: boolean;
  /** Attention axis introduced by Step 4 of the agent-state attention
   *  rebuild (decision tmai-core@2026-05-07). `null` / absent on the
   *  wire encodes "unknown" — the sampler bootstrap window per Δ6.
   *  Step 6a (this PR) made this the **only** dynamic-state surface
   *  on the wire; the legacy `status` / `phase` / `detail` /
   *  `needs_attention` / `has_pending_approval` pentad is gone. */
  attention?: AgentAttention | null;
  /** Per-agent context-window usage from CC's statusline hook. Drives
   *  the ProducerConsole ctx% header and the auto-handoff threshold
   *  trigger (handoff-lifecycle DR §B/§E). Absent / `null` when the
   *  agent has not yet emitted a statusline (typical for non-CC
   *  agents and for CC agents in their bootstrap window). */
  ctx_usage?: AgentCtxUsage | null;
  // Other derived fields computed by tmai-core
  display_label?: string;
  has_queued_prompt?: boolean;
  queued_prompt_count?: number;
  primary_worktree_path?: string | null;
  current_dispatch_id?: string | null;
}

// ── Bootstrap payload (all 9 domain snapshots in one shot) ──
//
// tmai-core PR #150 (`fix(sse): centralize wire-event production`) wraps the
// snapshot bundle in a `{ event, seq, snapshots }` envelope so the same shape
// can flow over both the REST `/api/bootstrap` response and the SSE
// "Bootstrap" frame. The flat `{ agents, worktrees, ... }` interface that
// existed before that PR has been replaced; consumers read from
// `payload.snapshots.<domain>`.

export interface BootstrapSnapshots {
  agents: AgentSnapshot[];
  worktrees: WorktreeSnapshot[];
  teams: TeamSnapshot[];
  queue: QueueSnapshot;
  dispatches: DispatchSnapshot[];
  workflow: WorkflowSnapshot;
  runtime: RuntimeSnapshot;
}

export interface BootstrapPayload {
  event: "Bootstrap";
  seq: number;
  snapshots: BootstrapSnapshots;
}

// ── Prompt Queue ──

import type { ActionOrigin } from "@/types";

export interface QueuedPrompt {
  id: string;
  prompt: string;
  queued_at: string; // RFC 3339
  origin?: ActionOrigin;
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
}

// Derive project display name from path
function projectName(path: string): string {
  // "/home/user/works/tmai/.git" → "tmai"
  // "/home/user/works/tmai" → "tmai"
  const cleaned = path.replace(/\/\.git\/?$/, "");
  return cleaned.split("/").filter(Boolean).pop() || path;
}

// Normalize git_common_dir: strip trailing /.git and slashes.
//
// Exported for unit tests. The trailing-slash trimmer used to be
// `.replace(/\/+$/, "")` but the `+` quantifier triggered CodeQL's
// `js/polynomial-redos` rule (alert #1) — `dir` flows in from
// `AgentSnapshot.git_common_dir` / `WorktreeSnapshot.repo_path` which
// counts as untrusted wire input, and a long run of `/` would burn
// quadratic time backtracking. A linear right-to-left scan finishes
// in O(n) regardless of input shape.
export function normalizeGitDir(dir: string): string {
  const cleaned = dir.replace(/\/\.git\/?$/, "");
  let end = cleaned.length;
  while (end > 0 && cleaned[end - 1] === "/") end--;
  return cleaned.slice(0, end);
}

// Group agents by project (git_common_dir) and worktree.
// When worktreeSnapshots is provided, agent-less worktrees are also shown.
export function groupByProject(
  agents: AgentSnapshot[],
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

    // Decision 2026-05-09 Phase 4: any non-null attention value means
    // the agent is on the user-blocked axis.
    const attentionCount = groupAgents.filter((a) => a.attention != null).length;

    projects.push({
      name: projectName(path),
      path,
      worktrees,
      totalAgents: groupAgents.length,
      attentionAgents: attentionCount,
    });
  }

  // Sort by name (stable — no attention reordering)
  projects.sort((a, b) => a.name.localeCompare(b.name));

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
  author?: string;
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

/** Merge strategy passed to `POST /api/github/pr/merge`. Mirrors the
 *  `method` enum the MCP `merge_pr` tool proxies to the same backend
 *  (squash is the repo default, matching the retired AI-merge prompt). */
export type PrMergeMethod = "squash" | "merge" | "rebase";

/**
 * Operator override for the billing-dead CI-safe merge path (approach
 * `2026-05-20-billing-dead-ci-safe-override`, Phase B). Lets the operator
 * merge a PR whose GitHub CI is red **only because** the repo's private
 * Actions billing has lapsed.
 *
 * Hand-typed here rather than imported from `src/types/generated/`: the
 * backend type is an inline `Deserialize`-only struct on
 * `POST /api/github/pr/merge` with no `ToSchema` / `ts_rs::TS` derive, so
 * there is no generated binding to re-export. Field names MUST byte-match
 * the backend's serde fields (`validate_billing_dead_override`).
 *
 * The UI never enforces — it only collects + sends. The backend is the
 * real gate: it requires `[github.<repo>] billing_dead = true` server-side
 * AND a valid attestation before doing `gh pr merge --admin`, posting a PR
 * comment, and baking the attestation into the merge-commit trailer.
 */
export interface PrMergeOverride {
  /** Pasted `ci-local` run summary attesting the change passed locally. */
  ci_local_attestation: string;
  /** Operator's explicit acknowledgement the repo is billing-dead. */
  repo_billing_dead_acknowledged: boolean;
}

/**
 * Response of `POST /api/github/pr/merge`.
 *
 * WHY permissive: this endpoint predates the Stage-1 doc stubs and is
 * not in `api-spec/openapi.json`, so its body shape is not codegen-
 * pinned. The UI treats a resolved `apiFetch` (HTTP 2xx) as success
 * and only surfaces `status` / `message` when the server includes them
 * — both are optional so a leaner body still type-checks.
 */
export interface MergePrResponse {
  status?: string;
  message?: string;
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

export interface SpawnSettings {
  runtime: SpawnRuntime;
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
  /** Skip ActionPerformed echoes for actions initiated by an orchestrator (#440). */
  suppress_self: boolean;
  /** Deliver ActionPerformed notifications whose origin is a human (#440). */
  notify_on_human_action: boolean;
  /** Deliver ActionPerformed notifications whose origin is a non-orchestrator agent (#440). */
  notify_on_agent_action: boolean;
  /** Deliver ActionPerformed notifications whose origin is a system process (#440). */
  notify_on_system_action: boolean;
}

export interface GuardrailsSettings {
  max_ci_retries: number;
  max_review_loops: number;
  escalate_to_human_after: number;
}

export type PrMonitorScope = "current_project" | "all";

export interface OrchestratorSettings {
  enabled: boolean;
  role: string;
  rules: OrchestratorRules;
  notify: NotifySettings;
  guardrails: GuardrailsSettings;
  auto_action_templates: AutoActionTemplates;
  pr_monitor_enabled: boolean;
  pr_monitor_interval_secs: number;
  pr_monitor_exclude_authors: string[];
  pr_monitor_scope: PrMonitorScope;
  /** Append a live state summary to the orchestrator's spawn prompt (#381) */
  inject_state_snapshot: boolean;
  /** Auto-handoff trigger threshold: Producer's hand-over-and-restart
   *  ritual fires when `ctx_usage.pct >= auto_handoff_threshold_pct`
   *  (handoff-lifecycle DR §B/§E). `0` disables the auto-trigger; the
   *  manual ritual button still works. Rust-side default is 75. */
  auto_handoff_threshold_pct: number;
  /** Whether this is a per-project override (true) or global fallback (false) */
  is_project_override: boolean;
  /**
   * Orchestrator's own dispatch bundle (`[orchestration.orchestrator]`).
   * `null` / omitted when unset — the orchestrator launches with the vendor
   * CLI's user-global default.
   */
  orchestrator?: DispatchBundle | null;
  /**
   * Per-role dispatch bundles for orchestration workers
   * (`[orchestration.dispatch.<role>]`).
   */
  dispatch: WorkerDispatchMap;
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

export interface GeneralSettings {
  /** Starting directory for the WebUI's directory browser. `null` falls
   *  back to the backend default (typically `$HOME`). */
  default_project_root: string | null;
}

export interface WorkflowSettings {
  auto_rebase_on_merge: boolean;
}

export interface WorktreeSettings {
  setup_commands: string[];
  setup_timeout_secs: number;
  branch_depth_warning: number;
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

// ── Decisions view (tmai-core PR #359) ──
//
// Wire types mirroring `tmai-core::api::decisions_view` for the
// `GET /api/units/{unit}/decisions` endpoint. Hand-written here until
// the `gen-spec-pr` bot PR syncs them into `src/types/generated/`;
// once that lands the hand-written exports collapse to re-exports of
// the generated bindings (same shape).
//
// Doc-decision basis: `2026-05-11-producer-conversation-workbench` §1
// (Settled-section projection) + DR §D of
// `2026-05-14-producer-capability-valve-principle` (per-repo render,
// no cross-repo aggregation).
export type DecisionStatusWire =
  | "draft"
  | "proposed"
  | "accepted"
  | "superseded"
  | "superseded-in-part";

export type DecisionCategoryWire = "scoped" | "principle" | "foundational";

export interface StaleSinceWire {
  path: string;
  change_date: string;
  change_sha: string;
  change_subject: string;
}

export interface DecisionWire {
  slug: string;
  title: string;
  status: DecisionStatusWire;
  category: DecisionCategoryWire;
  governs: string[];
  /** ISO-8601 date string, e.g. "2026-05-14". */
  last_verified: string;
  contract_surface: boolean;
  stale_since: StaleSinceWire | null;
  superseded_by: string[];
  strengthened_by: string[];
  excerpt: string;
}

export interface CurrencyItemWire {
  slug: string;
  title: string;
  stale: StaleSinceWire;
  last_verified: string;
  remedy: string;
}

export interface FoundationalDueWire {
  slug: string;
  title: string;
  last_verified: string;
  age_days: number;
  remedy: string;
}

export interface DecisionCountsWire {
  total: number;
  in_play: number;
  warm: number;
  cold: number;
  foundations: number;
  superseded: number;
  stale_suspect: number;
}

export interface RepoDecisionsWire {
  repo_label: string;
  repo_root: string;
  primary: boolean;
  repo_head: string | null;
  counts: DecisionCountsWire;
  currency_sweep: CurrencyItemWire[];
  foundational_due: FoundationalDueWire[];
  foundations: DecisionWire[];
  in_play: DecisionWire[];
  warm: DecisionWire[];
  cold: DecisionWire[];
  superseded: DecisionWire[];
}

export interface DecisionsResponse {
  unit: string;
  /** RFC3339 timestamp. */
  composed_at: string;
  repos: RepoDecisionsWire[];
}

// ── Working-with-human view (tmai-core PR #360) ──
//
// Mirror of `tmai-core::api::working_with_human_view::WorkingWithHumanResponse`.
// `dir = null` ⇒ no memory dir resolves for this unit; `dir` non-null
// + `memory_index = null` ⇒ the directory exists but `MEMORY.md` is
// absent. Hand-written until `gen-spec-pr` syncs the generated type.

export interface WorkingWithHumanResponse {
  unit: string;
  /** Absolute path of the resolved memory directory. `null` when no
   *  override is configured and the auto-derived
   *  `~/.claude/projects/<slug>/memory` doesn't exist. */
  dir: string | null;
  /** Raw markdown contents of `MEMORY.md` under `dir`. `null` when
   *  the file is absent. */
  memory_index: string | null;
}

// ── Active approaches view (tmai-core PR #369) ──
//
// Mirror of `tmai-core::api::approaches_view`. `RepoApproachesWire.active`
// carries `status: active` records only — validated / rejected / replaced
// are filtered at compose time (audit-trail, not yet on the wire; the
// console's Verdict-inbox surfaces that gap honestly per
// `doc/decisions/2026-05-14-webui-simulated-onboarded-posture.md`).
// Hand-written until `gen-spec-pr` syncs the generated type; A2 fidelity
// (core-computed trigger firing + verdict authority + settled projection)
// is tracked in tmai-core#381.

export type ApproachStatusWire = "active" | "validated" | "rejected" | "replaced";

/** One review trigger, tagged on `kind` (mirrors the Rust enum 1:1; the
 *  `Date` value is an ISO-8601 string on the wire). Only `date` is
 *  client-evaluable; the rest need core/gh resolution (tmai-core#381). */
export type ReviewTriggerWire =
  | { kind: "date"; value: string }
  | { kind: "pr-closed"; ref: string }
  | { kind: "pr-merged"; ref: string }
  | { kind: "issue-closed"; ref: string }
  | { kind: "decision-status"; ref: string; "target-status": string }
  | { kind: "approach-status"; ref: string; "target-status": string }
  | { kind: "manual"; description: string };

export interface ApproachWire {
  slug: string;
  title: string;
  /** ISO-8601 date from the slug prefix (creation date — approaches have
   *  no `last_verified`; re-evaluation is signal-driven). */
  date: string;
  status: ApproachStatusWire;
  governs: string[];
  /** `serves:` — the decision slug(s) this approach's means serve. */
  serves: string[];
  success_signal: string;
  failure_signal: string;
  review_triggers: ReviewTriggerWire[];
  /** Producer confidence; `null` when none on record. */
  confidence: "high" | "low" | null;
  /** Successor approach slugs — meaningful only when `status: replaced`. */
  replaced_by: string[];
  /** First-paragraph summary of the body. */
  excerpt: string;
}

export interface RepoApproachesWire {
  repo_label: string;
  repo_root: string;
  primary: boolean;
  repo_head: string | null;
  /** `status: active` records only (see module note). */
  active: ApproachWire[];
}

export interface ApproachesResponse {
  unit: string;
  /** RFC3339 compose timestamp. */
  composed_at: string;
  repos: RepoApproachesWire[];
}

// ── API wrappers ──

export const api = {
  // Bootstrap — all 9 domain snapshots in one request (Phase 2)
  bootstrap: () => apiFetch<BootstrapPayload>("/bootstrap"),

  // Agent queries
  listAgents: () => apiFetch<AgentSnapshot[]>("/agents"),
  attentionCount: async () => {
    const agents = await apiFetch<AgentSnapshot[]>("/agents");
    // Decision 2026-05-09 Phase 4: any non-null attention value flags
    // the user-blocked axis.
    return agents.filter((a) => a.attention != null).length;
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
  /// Mint a short-lived ticket for the rev3 terminal-plane stream
  /// (`useAgentTerminalStream`). The returned `stream_endpoint` is a
  /// relative URL — UIs concatenate `?ticket=<token>&mode=stream|keys`
  /// and open a WebSocket. Re-issue before `expires_at` to keep the
  /// stream alive.
  subscribeTerminal: (target: string) =>
    apiFetch<TerminalSubscription>(`/agents/${encodeURIComponent(target)}/subscribe-terminal`, {
      method: "POST",
    }),
  /// Notify the PTY-server of the viewer's current terminal dimensions so the
  /// agent's PTY winsize stays in sync with the xterm canvas. Fire-and-forget:
  /// callers should drop the returned promise.
  resizeAgentTerminal: (target: string, rows: number, cols: number) =>
    apiFetch(`/agents/${encodeURIComponent(target)}/resize`, {
      method: "POST",
      body: JSON.stringify({ rows, cols }),
    }),
  getTranscript: (target: string) =>
    apiFetch<{ records: TranscriptRecord[] }>(`/agents/${encodeURIComponent(target)}/transcript`),
  getPromptQueue: (agentId: string) =>
    apiFetch<QueuedPrompt[]>(`/agents/${encodeURIComponent(agentId)}/prompt-queue`),
  cancelQueuedPrompt: (agentId: string, promptId: string) =>
    apiFetch<{ status: "cancelled" | "already_drained" }>(
      `/agents/${encodeURIComponent(agentId)}/prompt-queue/${encodeURIComponent(promptId)}`,
      { method: "DELETE" },
    ),

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
  // Stage-1 in-tmai dev-loop (DR `2026-05-16-dev-loop-completes-in-tmai.md`
  // §A/§B): a PR's raw unified patch so the operator reviews the code
  // diff in-tmai. `repoPath` is an absolute `repo_path` from `unitPrs`.
  prDiff: (repoPath: string, prNumber: number) =>
    apiFetch<PrDiffResponse>(
      `/github/pr/diff?repo=${encodeURIComponent(repoPath)}&pr_number=${prNumber}`,
    ),
  // Stage-1 §C — direct operator merge. Replaces the retired AI-merge
  // delegation (ActionPanel/PrCard `delegateToAi('gh pr merge …')`):
  // the operator merges directly, not via a spawned agent. Defaults
  // (squash + delete-branch) match the prompt that path used; cleanup
  // of the head worktree stays off (Stage-1 scope is merge only).
  //
  // `opts.override` is the Phase B billing-dead CI-safe override (approach
  // `2026-05-20-billing-dead-ci-safe-override`): sent only when present,
  // so an ordinary merge body is byte-for-byte unchanged. The backend
  // re-validates the per-repo `billing_dead` flag + attestation; the UI
  // only collects + forwards.
  mergePr: (
    repoPath: string,
    prNumber: number,
    opts?: { method?: PrMergeMethod; deleteBranch?: boolean; override?: PrMergeOverride },
  ) =>
    apiFetch<MergePrResponse>("/github/pr/merge", {
      method: "POST",
      body: JSON.stringify({
        repo: repoPath,
        pr_number: prNumber,
        method: opts?.method ?? "squash",
        delete_branch: opts?.deleteBranch ?? true,
        ...(opts?.override ? { override: opts.override } : {}),
      }),
    }),
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

  // General settings (`[general]` table) — currently just `default_project_root`.
  getGeneralSettings: () => apiFetch<GeneralSettings>("/settings/general"),
  // PUT body uses double-Option semantics for `default_project_root`:
  //   { default_project_root: "/path" } → set
  //   { default_project_root: null }    → clear (key removed from config.toml)
  //   {}                                → no-op
  updateGeneralSettings: (params: { default_project_root?: string | null }) =>
    apiFetch("/settings/general", {
      method: "PUT",
      body: JSON.stringify(params),
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
  updateSpawnSettings: (params: { runtime: SpawnRuntime; tmux_window_name?: string }) =>
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
      pr_monitor_exclude_authors?: string[];
      pr_monitor_scope?: PrMonitorScope;
      inject_state_snapshot?: boolean;
      auto_handoff_threshold_pct?: number;
      /**
       * Tri-state: omit → leave unchanged. `null` → clear the bundle. Object →
       * replace. Persists to `[orchestration.orchestrator]` in config.toml.
       */
      orchestrator?: DispatchBundle | null;
      /** Replaces the entire `[orchestration.dispatch]` table. */
      dispatch?: WorkerDispatchMap;
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

  // Calibration view — read-only window into Producer hit-rate per
  // `2026-05-13-synthesis-processing-and-calibration-schema.md` §B.3.
  // `days = 0` means "whole store, no time filter"; default 90 mirrors
  // the CLI's default.
  calibration: (unit: string, days = 90) =>
    apiFetch<CalibrationResponse>(`/units/${encodeURIComponent(unit)}/calibration?days=${days}`),

  // Decisions view — bucketed projection of `compose()`'s Settled section
  // per `2026-05-11-producer-conversation-workbench.md` §1. Returns
  // per-repo groups (single-element list for a single-repo unit; multi-
  // repo unit follows once `UnitConfig.also[]` lands in tmai-core#340).
  decisions: (unit: string) =>
    apiFetch<DecisionsResponse>(`/units/${encodeURIComponent(unit)}/decisions`),

  // Active approaches view — `▣ Active approaches` slice of `compose()`
  // (tmai-core PR #369). `status: active` records only; per-repo groups
  // (multi-repo follows tmai-core#340, same as decisions). The console
  // turns this into the Verdict-inbox.
  approaches: (unit: string) =>
    apiFetch<ApproachesResponse>(`/units/${encodeURIComponent(unit)}/approaches`),

  // Unit-scoped cross-repo open-PR list — Stage-1 in-tmai dev-loop
  // (DR `2026-05-16-dev-loop-completes-in-tmai.md` §A). One unified
  // list across every repo in the unit, each PR repo-tagged (path +
  // stable label + primary flag); the React side renders one flat
  // list, NOT a per-repo switcher. Single-repo unit collapses to
  // `repos.length === 1`.
  unitPrs: (unit: string) => apiFetch<UnitPrsResponse>(`/units/${encodeURIComponent(unit)}/prs`),

  // Working-with-human view — memory dir + MEMORY.md projection of
  // `compose()`'s ◐ section per the same DR. Surfaces the same content
  // the Producer reads on session-start (process rules, cross-conversation
  // memory index) so the WebUI can render the digest's fourth section
  // without a Producer being attached.
  workingWithHuman: (unit: string) =>
    apiFetch<WorkingWithHumanResponse>(`/units/${encodeURIComponent(unit)}/working-with-human`),

  // Handoff-and-restart ritual (tmai-core PR #352, DR
  // `2026-05-14-handoff-lifecycle-and-kill-ux.md` §C/§F). Kicks off the
  // server-side ritual and returns a fresh `ritual_id` callers correlate
  // against SSE `handoff_ritual` events to drive the overlay / dialog.
  // PR4 wires only `trigger: "manual"`; the auto-trigger path with
  // `ctx_pct` lands in PR5 (statusline auto-handoff).
  //
  // Surfaces typed `HandoffRitualRequestError`s so consumers can route
  // 400 (invalid trigger / OOR ctx_pct) and 404 (unknown unit) to the
  // failure dialog with a sensible reason instead of swallowing them
  // as generic API errors.
  triggerHandoffRitual: (unit: string, body: TriggerHandoffRitualRequest) =>
    handoffFetch(unit, body),
};

async function handoffFetch(
  unit: string,
  body: TriggerHandoffRitualRequest,
): Promise<TriggerHandoffRitualResponse> {
  const url = `${config.baseUrl}/api/units/${encodeURIComponent(unit)}/handoff-and-restart`;
  const origin: { kind: "Human"; interface: string; cwd?: string } = {
    kind: "Human",
    interface: "webui",
    ...(callerCwd !== null ? { cwd: callerCwd } : {}),
  };
  const res = await fetch(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.token}`,
      "X-Tmai-Origin": JSON.stringify(origin),
    },
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new HandoffRitualRequestError(res.status, detail);
  }
  return (await res.json()) as TriggerHandoffRitualResponse;
}

// ── Handoff-ritual request/response shapes ──

/**
 * Body for `POST /api/units/{unit}/handoff-and-restart`.
 *
 * PR4 is manual-only on the wire side — `trigger: "auto"` (and its
 * accompanying `ctx_pct`) is reserved for the statusline auto-trigger
 * landing in PR5.
 */
export interface TriggerHandoffRitualRequest {
  trigger: "manual";
  reason?: string;
}

export interface TriggerHandoffRitualResponse {
  ritual_id: string;
}

/**
 * Typed error raised by `triggerHandoffRitual`. Surfaces the HTTP
 * status so callers can distinguish:
 *   - 400 — bad trigger / out-of-range ctx_pct (the future PR5
 *     auto-trigger case, but we keep the surface unified)
 *   - 404 — unknown unit
 *   - other — transport / server-side rejection
 *
 * The unwrapped raw body lives on `.detail`; downstream UI components
 * decide whether to surface it.
 */
export class HandoffRitualRequestError extends Error {
  readonly status: number;
  readonly detail: string;
  constructor(status: number, detail: string) {
    super(`handoff-and-restart failed: ${status} ${detail}`);
    this.name = "HandoffRitualRequestError";
    this.status = status;
    this.detail = detail;
  }
}

// ── SSE event subscription ──

// SSE event names that carry EntityUpdateEnvelope payloads (Phase 2).
const ENTITY_UPDATE_EVENTS = [
  "AgentUpdate",
  "WorktreeUpdate",
  "QueueUpdate",
  "TeamUpdate",
  "DispatchUpdate",
  "WorkflowUpdate",
  "RuntimeUpdate",
  "ApprovalUpdate",
] as const;

/// Subscribe to SSE named events from /api/events.
///
/// Phase 2 additions:
///   - `since` — reconnect with `?since=<seq>` to replay missed entity updates
///   - `onEntityUpdate` — called for each EntityUpdateEnvelope (AgentUpdate, etc.)
///   - `onBootstrapRequired` — called when the server's event buffer overflowed;
///     consumer should re-bootstrap and reconnect
///
/// Legacy events (agents, teams, git_state_changed, …) are still forwarded via
/// `onAgents` / `onEvent` for parallel Phase 1 compatibility; Phase 3 removes them.
///
/// Implements controlled reconnect: on SSE error the connection is closed and
/// reopened after a 3 s backoff with the current `?since=<seq>`, so the server
/// replays any events missed during the gap.
export function subscribeSSE(
  handlers: {
    onAgents?: (agents: AgentSnapshot[]) => void;
    onEvent?: (eventName: string, data: unknown) => void;
    onEntityUpdate?: (envelope: EntityUpdateEnvelope) => void;
    onBootstrapRequired?: (event: BootstrapRequiredEvent) => void;
    /// Fires on every SSE connection *after* the first successful open.
    onReconnect?: () => void;
  },
  since?: bigint,
): { unlisten: () => void } {
  let stopped = false;
  let lastSeq: bigint | undefined = since;
  const esHolder: { current: EventSource | null } = { current: null };

  function connect(): void {
    if (stopped) return;
    const sinceParam = lastSeq != null ? `&since=${lastSeq}` : "";
    const url = `${config.baseUrl}/api/events?token=${config.token}${sinceParam}`;
    const es = new EventSource(url);
    esHolder.current = es;

    // Track first-vs-subsequent opens so onReconnect only fires on reopen.
    let firstOpen = true;
    es.addEventListener("open", () => {
      if (firstOpen) {
        firstOpen = false;
        return;
      }
      handlers.onReconnect?.();
    });

    // Entity-Update envelopes (Phase 2) — track lastSeq for reconnect
    for (const name of ENTITY_UPDATE_EVENTS) {
      es.addEventListener(name, (e) => {
        try {
          const envelope = JSON.parse(e.data) as EntityUpdateEnvelope;
          if (lastSeq === undefined || envelope.seq > lastSeq) {
            lastSeq = envelope.seq;
          }
          handlers.onEntityUpdate?.(envelope);
        } catch {
          // Ignore parse errors
        }
      });
    }

    // BootstrapRequired — server buffer overflowed; consumer must re-bootstrap
    es.addEventListener("BootstrapRequired", (e) => {
      try {
        const event = JSON.parse(e.data) as BootstrapRequiredEvent;
        handlers.onBootstrapRequired?.(event);
      } catch {
        // Ignore parse errors
      }
    });

    // "agents" named event — full agent list (legacy, still emitted in Phase 1/2)
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
      // PR monitor events — drive WebUI lockstep with PR Monitor's poll tick (#422)
      "pr_created",
      "pr_ci_passed",
      "pr_ci_failed",
      "pr_review_feedback",
      "pr_closed",
      // Git monitor transition event — BranchGraph refetches branches + graph
      // in response (#423). Without this registration, EventSource silently
      // drops every `git_state_changed` payload and the panel never learns
      // about backend git transitions.
      "git_state_changed",
      // Producer handoff-and-restart ritual phase transitions (DR
      // `2026-05-14-handoff-lifecycle-and-kill-ux.md` §F). Without this
      // registration `useHandoffRitual` never gets a phase update and
      // the overlay sits in `in_progress` forever.
      "handoff_ritual",
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

    // Controlled reconnect: close and reopen with ?since=lastSeq after backoff
    // so the server replays events missed during the disconnect window.
    es.onerror = () => {
      if (esHolder.current === es) {
        es.close();
        esHolder.current = null;
        if (!stopped) {
          setTimeout(() => connect(), 3000);
        }
      }
    };
  }

  connect();

  return {
    unlisten: () => {
      stopped = true;
      esHolder.current?.close();
      esHolder.current = null;
    },
  };
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
