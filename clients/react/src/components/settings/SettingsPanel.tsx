import { useEffect, useMemo, useState } from "react";
import { type AgentSnapshot, api, groupByProject } from "@/lib/api";
import { DisplayLayoutSection } from "./DisplayLayoutSection";
import { GeneralSection } from "./GeneralSection";
import { NotificationSection } from "./NotificationSection";
import { OrchestrationDispatchSection } from "./OrchestrationDispatchSection";
import { OrchestrationSection } from "./OrchestrationSection";
import { SpawnSection } from "./SpawnSection";
import { UsageSection } from "./UsageSection";
import { WorkflowSection } from "./WorkflowSection";
import { WorktreeSection } from "./WorktreeSection";

interface SettingsPanelProps {
  onClose: () => void;
}

// Visual divider between "Core" (tmai-core config.toml) and "WebUI" (this
// browser's localStorage) groups so the user can tell at a glance which
// store a setting writes to.
function GroupHeader({ label, description }: { label: string; description: string }) {
  return (
    <div className="border-b border-white/10 pb-2">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-cyan-400/80">
        {label}
      </div>
      <p className="mt-1 text-xs text-zinc-600">{description}</p>
    </div>
  );
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
        <GroupHeader
          label="tmai (core)"
          description="Server-side settings persisted to ~/.config/tmai/config.toml. Shared across CLI, TUI, and WebUI."
        />
        <GeneralSection />
        <SpawnSection />
        <OrchestrationSection projects={projects} />
        <OrchestrationDispatchSection />
        <UsageSection />
        <NotificationSection />
        <WorkflowSection />
        <WorktreeSection />

        <GroupHeader
          label="WebUI (this browser)"
          description="Per-browser layout for the agent main panel. Stored in localStorage, not in tmai-core."
        />
        <DisplayLayoutSection />
      </div>
    </div>
  );
}
