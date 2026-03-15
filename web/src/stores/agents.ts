import { create } from "zustand";
import type { Agent } from "../types/agent";

interface AgentsState {
  agents: Agent[];
  selectedProject: string | null;
  selectedAgentId: string | null;

  setAgents: (agents: Agent[]) => void;
  selectProject: (project: string | null) => void;
  selectAgent: (id: string | null) => void;
}

export const useAgentsStore = create<AgentsState>((set) => ({
  agents: [],
  selectedProject: null,
  selectedAgentId: null,

  setAgents: (agents) => set({ agents }),

  selectProject: (project) =>
    set({ selectedProject: project, selectedAgentId: null }),

  selectAgent: (id) => set({ selectedAgentId: id }),
}));
