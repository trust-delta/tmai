import { useEffect, useMemo, useState } from "react";
import { type AgentSnapshot, api, groupByProject } from "@/lib/api";
import { AutoApproveSection } from "./AutoApproveSection";
import { GeneralSection } from "./GeneralSection";
import { NotificationSection } from "./NotificationSection";
import { OrchestrationDispatchSection } from "./OrchestrationDispatchSection";
import { OrchestrationSection } from "./OrchestrationSection";
import { ScheduledSection } from "./ScheduledSection";
import { SpawnSection } from "./SpawnSection";
import { UsageSection } from "./UsageSection";
import { WorkflowSection } from "./WorkflowSection";
import { WorktreeSection } from "./WorktreeSection";

interface SettingsPanelProps {
  onClose: () => void;
}

/**
 * Settings panel layout shell. Each section component owns its own state,
 * save tracker, and load. The shell only sources the project list — derived
 * from currently active agents — used by `OrchestrationSection`'s per-project
 * override scope selector.
 */
export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const [agents, setAgents] = useState<AgentSnapshot[]>([]);

  // Pre-registered projects were retired in favour of deriving the scope
  // selector's options from live agent cwds. We fetch agents here (not via
  // the cross-cutting useAgents hook) because SettingsPanel is a leaf and
  // doesn't need the full SSE wiring — a one-shot snapshot is enough.
  useEffect(() => {
    api.listAgents().then(setAgents).catch(console.error);
  }, []);

  const projects = useMemo(() => groupByProject(agents).map((p) => p.path), [agents]);

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
        <GeneralSection />
        <AutoApproveSection />
        <SpawnSection />
        <OrchestrationSection projects={projects} />
        <OrchestrationDispatchSection />
        <ScheduledSection />
        <UsageSection />
        <NotificationSection />
        <WorkflowSection />
        <WorktreeSection />
      </div>
    </div>
  );
}
