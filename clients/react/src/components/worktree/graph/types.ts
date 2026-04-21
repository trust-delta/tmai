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

// Discriminated union for row types — TypeScript narrows automatically on `kind`
export type RowInfo = CommitRow | FoldRow;

export interface CommitRow {
  kind: "commit";
  sha: string;
  lane: number;
  y: number;
  subject: string;
  refs: string[];
  isMerge: boolean;
}

export interface FoldRow {
  kind: "fold";
  sha: string;
  lane: number;
  y: number;
  foldCount: number;
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
  diffSummary: {
    files_changed: number;
    insertions: number;
    deletions: number;
  } | null;
  worktree: import("@/lib/api").WorktreeSnapshot | null;
  ahead: number;
  behind: number;
  remote: RemoteTrackingInfo | null;
  isRemoteOnly: boolean;
  lastCommitTime: number | null;
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
