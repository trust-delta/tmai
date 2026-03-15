import { create } from "zustand";
import type { Agent } from "../types/agent";
import { projectKey } from "../lib/groupByProject";

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

  /** Update agents and clear stale selections */
  setAgents: (agents) =>
    set((state) => {
      const projectKeys = new Set(agents.map((a) => projectKey(a)));

      return {
        agents,
        selectedProject:
          state.selectedProject && projectKeys.has(state.selectedProject)
            ? state.selectedProject
            : null,
        selectedAgentId:
          state.selectedAgentId &&
          agents.some((a) => a.id === state.selectedAgentId)
            ? state.selectedAgentId
            : null,
      };
    }),

  selectProject: (project) =>
    set({ selectedProject: project, selectedAgentId: null }),

  selectAgent: (id) => set({ selectedAgentId: id }),
}));
