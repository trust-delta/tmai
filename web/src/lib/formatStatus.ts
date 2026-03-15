import type { StatusInfo } from "../types/agent";

/** Human-readable status label */
export function statusLabel(status: StatusInfo): string {
  switch (status.type) {
    case "idle":
      return "Idle";
    case "processing":
      return status.message ?? "Processing…";
    case "awaiting_approval":
      return "Awaiting Approval";
    case "error":
      return `Error: ${status.message}`;
    case "offline":
      return "Offline";
    case "unknown":
      return "Unknown";
  }
}

/** CSS color class for status */
export function statusColor(status: StatusInfo): string {
  switch (status.type) {
    case "idle":
      return "text-green-400";
    case "processing":
      return "text-blue-400";
    case "awaiting_approval":
      return "text-yellow-400";
    case "error":
      return "text-red-400";
    case "offline":
      return "text-neutral-500";
    case "unknown":
      return "text-neutral-400";
  }
}

/** Detection source icon */
export function detectionIcon(agentType: string): string {
  switch (agentType) {
    case "claude":
      return "◈";
    case "codex":
      return "◉";
    case "gemini":
      return "○";
    default:
      return "●";
  }
}
