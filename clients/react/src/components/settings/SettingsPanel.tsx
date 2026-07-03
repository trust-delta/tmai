import { useEffect, useMemo, useState } from "react";
import { type AgentSnapshot, api, groupByProject } from "@/lib/api";
import { DisplayLayoutSection } from "./DisplayLayoutSection";
import { GeneralSection } from "./GeneralSection";
import { HandoffThresholdSection } from "./HandoffThresholdSection";
import { NotificationSection } from "./NotificationSection";
import { ProducerDispatchSection } from "./ProducerDispatchSection";
import { ProducerSection } from "./ProducerSection";
import { ThemeSection } from "./ThemeSection";
import { WorkflowSection } from "./WorkflowSection";
import { WorktreeSection } from "./WorktreeSection";

interface SettingsPanelProps {
  onClose: () => void;
  /** The rarely-tuned automation settings live behind a collapsed Advanced
   *  section. When the operator deep-links to a specific control, open
   *  Advanced by default so they land on it without an extra click;
   *  otherwise it stays collapsed. */
  defaultOpenAdvanced?: boolean;
}

// Visual divider between "Core" (tmai-core config.toml) and "WebUI" (this
// browser's localStorage) groups so the user can tell at a glance which
// store a setting writes to.
function GroupHeader({ label, description }: { label: string; description: string }) {
  return (
    <div className="border-b border-hairline-strong pb-2">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-primary/80">
        {label}
      </div>
      <p className="mt-1 text-xs text-subtle-foreground">{description}</p>
    </div>
  );
}

/**
 * Settings panel layout shell. Each section component owns its own state,
 * save tracker, and load. The shell only sources the project list — derived
 * from currently active agents — used by `ProducerSection`'s per-project
 * override scope selector.
 *
 * Layout: the commonly-touched Producer settings sit at the top of the Core
 * group; the automation the Producer relies on (PR/CI monitor spawning,
 * worker-dispatch bundles, auto-rebase, worktree setup) falls behind a
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
      <div className="flex items-center justify-between border-b border-hairline px-6 py-4">
        <h2 className="text-lg font-semibold text-foreground">Settings</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-3 py-1 text-sm text-muted-foreground transition-colors hover:bg-surface-strong hover:text-foreground"
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

        {/* Advanced: the automation the Producer relies on — tuned rarely,
            so collapsed by default but reachable. `<details>` is native /
            keyboard-accessible; `open={defaultOpenAdvanced}` lands a control
            deep-link with the section already expanded. */}
        <details
          className="rounded-md border border-hairline bg-surface"
          open={defaultOpenAdvanced}
        >
          <summary className="cursor-pointer select-none px-4 py-3 text-sm text-foreground hover:bg-surface">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-primary/80">
              Advanced
            </span>{" "}
            — automation & worker dispatch
            <p className="mt-1 text-xs font-normal normal-case tracking-normal text-muted-foreground">
              Live automation the Producer relies on: PR/CI monitor spawning, worker-dispatch
              permission bundles, auto-rebase on merge, and worktree setup. Tuned rarely — open to
              adjust.
            </p>
          </summary>
          <div className="space-y-6 border-t border-hairline px-4 py-4">
            <ProducerSection projects={projects} />
            <ProducerDispatchSection />
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
