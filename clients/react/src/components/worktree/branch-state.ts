import type { PrInfo } from "@/lib/api";
import type { BranchNode } from "./graph/types";

/**
 * Represents the lifecycle state of a branch, used to determine
 * which action buttons are relevant in the ActionPanel.
 */
export type BranchState = "merged" | "has-open-pr" | "active" | "stale" | "default";

/** Derive the lifecycle state of a branch from its node data and optional PR info. */
export function deriveBranchState(node: BranchNode, prInfo?: PrInfo): BranchState {
  // 1. Merged — PR exists and is merged
  if (prInfo?.state === "merged") return "merged";

  // 2. Has open PR — PR exists and is open
  if (prInfo?.state === "open") return "has-open-pr";

  // 3. Active — agent is currently running on this branch
  if (node.hasAgent) return "active";

  // 4. Stale — behind parent, no agent, no new work (ahead === 0)
  if (node.behind > 0 && !node.hasAgent && node.ahead === 0) return "stale";

  // 5. Default — normal working branch
  return "default";
}

/** Human-readable label for a branch state badge. */
export function branchStateLabel(state: BranchState): string {
  switch (state) {
    case "merged":
      return "Merged";
    case "has-open-pr":
      return "PR Open";
    case "active":
      return "Active";
    case "stale":
      return "Stale";
    case "default":
      return "";
  }
}

/** Tailwind classes for the branch state badge. */
export function branchStateBadgeClass(state: BranchState): string {
  switch (state) {
    case "merged":
      return "bg-purple-500/15 text-purple-400";
    case "has-open-pr":
      return "bg-blue-500/15 text-blue-400";
    case "active":
      return "bg-cyan-500/15 text-cyan-400";
    case "stale":
      return "bg-amber-500/15 text-amber-400";
    case "default":
      return "";
  }
}
