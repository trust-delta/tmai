import { useEffect, useMemo, useState } from "react";
import { type AgentSnapshot, api, groupByProject } from "@/lib/api";
import { DisplayLayoutSection } from "./DisplayLayoutSection";
import { GeneralSection } from "./GeneralSection";
import { HandoffThresholdSection } from "./HandoffThresholdSection";
import { NotificationSection } from "./NotificationSection";
import { OrchestrationDispatchSection } from "./OrchestrationDispatchSection";
import { OrchestrationSection } from "./OrchestrationSection";
import { SpawnSection } from "./SpawnSection";
import { ThemeSection } from "./ThemeSection";
import { UsageSection } from "./UsageSection";
import { WorkflowSection } from "./WorkflowSection";
import { WorktreeSection } from "./WorktreeSection";

interface SettingsPanelProps {
  onClose: () => void;
  /** Phase B of the Producer-console rebuild
   *  (`doc/decisions/2026-05-14-react-producer-console-rebuild.md`)
   *  collapses orchestrator-era controls behind an Advanced section.
   *  When the operator arrives here from `ProducerConsoleActions`'
   *  Operator-override panel, we want Advanced open by default so
   *  the deep-link lands on the controls the operator was after.
   *  Otherwise default-closed: the post-inversion default is to
   *  let the Producer route work. */
  defaultOpenAdvanced?: boolean;
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
 *
 * Phase B layout: Producer-relevant sections sit at the top of the Core
 * group; orchestrator-era controls (spawn defaults, orchestration rules,
 * dispatch bundles, workflow engine, worktree ops) fall behind a
 * `<details>`-backed Advanced expandable. The WebUI group is unchanged.
 */
export function SettingsPanel({ onClose, defaultOpenAdvanced = false }: SettingsPanelProps) {
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
          label="Producer"
          description="Settings the Producer and the human console both read. Stored in ~/.config/tmai/config.toml; shared across CLI, TUI, and WebUI."
        />
        <GeneralSection />
        <HandoffThresholdSection />
        <NotificationSection />
        <UsageSection />

        {/* Advanced — Phase B: orchestrator-era controls live here, off
            the main flow but reachable. `<details>` is native /
            keyboard-accessible; `open={defaultOpenAdvanced}` makes
            the override-deep-link land with the section already
            expanded so the operator doesn't have to click twice. */}
        <details
          className="rounded-md border border-white/5 bg-white/[0.02]"
          open={defaultOpenAdvanced}
        >
          <summary className="cursor-pointer select-none px-4 py-3 text-sm text-zinc-300 hover:bg-white/[0.04]">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-400/80">
              Advanced
            </span>{" "}
            — orchestrator-era controls
            <p className="mt-1 text-xs font-normal normal-case tracking-normal text-zinc-500">
              These bypass the Producer (manual spawn defaults, orchestration rules, dispatch
              bundles, workflow engine, worktree ops). The post-inversion default is to let the
              Producer route work — open this only when you need to override directly.
            </p>
          </summary>
          <div className="space-y-6 border-t border-white/5 px-4 py-4">
            <SpawnSection />
            <OrchestrationSection projects={projects} />
            <OrchestrationDispatchSection />
            <WorkflowSection />
            <WorktreeSection />
          </div>
        </details>

        <GroupHeader
          label="WebUI (this browser)"
          description="Per-browser presentation. Stored in localStorage, not in tmai-core."
        />
        <ThemeSection />
        <DisplayLayoutSection />
      </div>
    </div>
  );
}
