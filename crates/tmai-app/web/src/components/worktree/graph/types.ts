import type { RemoteTrackingInfo } from "@/lib/api";

export interface LaneLayout {
  lanes: LaneInfo[];
  rows: RowInfo[];
  connections: Connection[];
  laneW: number;
  svgWidth: number;
  svgHeight: number;
}

export interface LaneInfo {
  branch: string;
  laneIndex: number;
  color: string;
  isActive: boolean;
}

export interface RowInfo {
  sha: string;
  lane: number;
  y: number;
  subject: string;
  refs: string[];
  isMerge: boolean;
  isFold?: boolean;
  foldCount?: number;
}

export interface Connection {
  fromLane: number;
  toLane: number;
  fromY: number;
  toY: number;
  type: "fork" | "merge";
  color: string;
}

// Re-export for convenience
export interface BranchNode {
  name: string;
  parent: string | null;
  isWorktree: boolean;
  isMain: boolean;
  isCurrent: boolean;
  isDirty: boolean;
  hasAgent: boolean;
  agentTarget: string | null;
  agentStatus: string | null;
  diffSummary: { files_changed: number; insertions: number; deletions: number } | null;
  worktree: import("@/lib/api").WorktreeSnapshot | null;
  ahead: number;
  behind: number;
  remote: RemoteTrackingInfo | null;
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
}
