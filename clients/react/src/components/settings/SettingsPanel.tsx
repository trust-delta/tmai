import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { AutoApproveSection } from "./AutoApproveSection";
import { NotificationSection } from "./NotificationSection";
import { OrchestrationDispatchSection } from "./OrchestrationDispatchSection";
import { OrchestrationSection } from "./OrchestrationSection";
import { ProjectsSection } from "./ProjectsSection";
import { ScheduledKicksSection } from "./ScheduledKicksSection";
import { SpawnSection } from "./SpawnSection";
import { UsageSection } from "./UsageSection";
import { WorkflowSection } from "./WorkflowSection";
import { WorktreeSection } from "./WorktreeSection";

interface SettingsPanelProps {
  onClose: () => void;
  onProjectsChanged: () => void;
}

/**
 * Settings panel layout shell. Each section component owns its own state,
 * save tracker, and load — the parent only carries the project list (used
 * by both `OrchestrationSection`'s scope selector and `ProjectsSection`'s
 * registered-project view) and the cross-component refresh callback.
 */
export function SettingsPanel({ onClose, onProjectsChanged }: SettingsPanelProps) {
  const [projects, setProjects] = useState<string[]>([]);

  const refreshProjects = useCallback(() => {
    api.listProjects().then(setProjects).catch(console.error);
  }, []);

  useEffect(() => {
    refreshProjects();
  }, [refreshProjects]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/5 px-6 py-4">
        <h2 className="text-lg font-semibold text-zinc-200">Settings</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-3 py-1 text-sm text-zinc-500 transition-colors hover:bg-white/10 hover:text-zinc-300"
        >
          Close
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
        <AutoApproveSection />
        <SpawnSection />
        <OrchestrationSection projects={projects} />
        <OrchestrationDispatchSection />
        <ScheduledKicksSection />
        <UsageSection />
        <NotificationSection />
        <WorkflowSection />
        <WorktreeSection />
        <ProjectsSection
          projects={projects}
          refreshProjects={refreshProjects}
          onProjectsChanged={onProjectsChanged}
        />
      </div>
    </div>
  );
}
