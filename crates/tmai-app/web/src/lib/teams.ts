// Team management types and API methods

export type TaskStatus = 
  | "pending" 
  | "in_progress" 
  | "completed";

export interface TeamTaskInfo {
  /// Task ID
  id: string;
  /// Task subject
  subject: string;
  /// Task status
  status: TaskStatus;
  /// Task owner (agent name or user)
  owner: string | null;
  /// Task description
  description: string;
}

export interface TeamSummary {
  /// Team name
  name: string;
  /// Team description  
  description: string | null;
  /// Number of team members
  member_count: number;
  /// Completed task count
  task_done: number;
  /// Total task count
  task_total: number;
}

export interface TeamMember {
  name: string;
  id: string;
  agent_type: string;
}

export interface TeamDetails extends TeamSummary {
  members: TeamMember[];
  tasks: TeamTaskInfo[];
}
