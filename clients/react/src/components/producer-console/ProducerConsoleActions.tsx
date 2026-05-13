// Bottom action row of the Producer console.
//
// Three affordances, left-to-right:
//
// 1. **Open Producer terminal ▸** — clipboard copy of
//    `tmai producer <unit>` (Phase A fallback). Decision
//    `doc/decisions/2026-05-14-react-producer-console-rebuild.md` §
//    "Producer chat" defers an in-WebUI launch endpoint to Phase D —
//    the substrate swap is explicitly rejected per cross-ref
//    `tmai-core@2026-05-13-agent-view-does-not-replace-multiplexer-
//    substrate`, so the WebUI's role here is to make the command
//    trivially copy-pasteable, nothing more.
//
// 2. **Calibration ▸** — jumps into the existing `<CalibrationPanel>`
//    full-screen view (PR #671). Disabled when no unit is resolvable
//    (`unitName === null`) so the user doesn't open a panel that
//    can't fetch anything.
//
// 3. **Operator override ▾** — expandable. Phase B (this revision):
//    real surface for the post-inversion "bypass the Producer"
//    escape hatch. Hosts the legacy spawn path (NewAgentLauncher),
//    a sidebar-expand affordance when the sidebar is collapsed
//    (default per `useResponsiveLayout`), and a deep-link into the
//    Settings page where orchestration / dispatch-bundle config
//    lives. Per `feedback_pty_emergency_terminal_access` we keep
//    the override path — we just route it off the main flow.

import { useState } from "react";
import { NewAgentLauncher } from "@/components/project/NewAgentLauncher";
import type { CalibrationResponse } from "@/lib/api";

interface ProducerConsoleActionsProps {
  unitName: string | null;
  calibrationData: CalibrationResponse | null;
  onOpenProducerTerminal: () => void;
  onOpenCalibration: () => void;
  /** Spawn callback for the operator-override NewAgentLauncher. Wired
   *  to App.tsx's `handleSpawned` so legacy spawns from inside the
   *  console still propagate selection + toast + cache refresh. */
  onOverrideSpawned: (sessionId: string) => void;
  /** Re-expand the sidebar when the operator wants to see the raw
   *  AgentList. The button is only shown when the sidebar is
   *  currently collapsed. */
  onOpenSidebar: () => void;
  sidebarCollapsed: boolean;
  /** Open Settings (where orchestration / dispatch-bundle editors
   *  still live). The override panel deep-links there as the
   *  Phase-B compromise until Settings tabs themselves are
   *  reorganized in a follow-up. */
  onOpenSettings: () => void;
}

export function ProducerConsoleActions({
  unitName,
  calibrationData,
  onOpenProducerTerminal,
  onOpenCalibration,
  onOverrideSpawned,
  onOpenSidebar,
  sidebarCollapsed,
  onOpenSettings,
}: ProducerConsoleActionsProps) {
  const [overrideOpen, setOverrideOpen] = useState(false);
  const tripwireCount = calibrationData?.tier1_violations.length ?? 0;
  const calCount = calibrationData?.total_in_window ?? 0;

  return (
    <div className="border-t border-white/5">
      <div className="flex items-center gap-2 px-6 py-3">
        <button
          type="button"
          onClick={onOpenProducerTerminal}
          disabled={unitName === null}
          className="rounded-md bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-300 transition-colors hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-50"
          title={
            unitName === null
              ? "No unit resolvable yet — select a project first"
              : `Launch the Producer for ${unitName} — tmai spawns it in-place and this pane switches to the conversation`
          }
        >
          Open Producer terminal ▸
        </button>

        <button
          type="button"
          onClick={onOpenCalibration}
          disabled={unitName === null}
          className="rounded-md bg-white/[0.04] px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
          title={
            unitName === null
              ? "No unit resolvable yet — select a project first"
              : "Open the calibration drill-down"
          }
        >
          Calibration ▸
          {tripwireCount > 0 && (
            <span className="ml-1.5 rounded-full bg-red-500/30 px-1.5 py-0.5 text-[10px] text-red-200">
              ⚡ {tripwireCount}
            </span>
          )}
          {tripwireCount === 0 && calCount > 0 && (
            <span className="ml-1.5 text-[10px] text-zinc-500">{calCount}</span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setOverrideOpen((o) => !o)}
          aria-expanded={overrideOpen}
          aria-controls="operator-override-panel"
          className="ml-auto rounded-md bg-white/[0.02] px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-zinc-200"
          title="Bypass the Producer — for emergency / debug use only"
        >
          Operator override {overrideOpen ? "▴" : "▾"}
        </button>
      </div>

      {overrideOpen && (
        <div
          id="operator-override-panel"
          className="border-t border-white/5 bg-white/[0.02] px-6 py-3"
        >
          <p className="text-[11px] uppercase tracking-wider text-zinc-500">Operator override</p>
          <p className="mt-1 text-xs text-zinc-500">
            These shortcuts bypass the Producer. The post-inversion default is to let the Producer
            route work — use these only when the Producer isn't running, you need to intervene
            directly, or you're debugging.
          </p>

          <div className="mt-3 space-y-2">
            <NewAgentLauncher onSpawned={onOverrideSpawned} />

            {sidebarCollapsed && (
              <button
                type="button"
                onClick={onOpenSidebar}
                className="block w-full rounded-md border border-white/5 bg-white/[0.02] px-3 py-2 text-left text-xs text-zinc-300 transition-colors hover:bg-white/[0.06]"
                title="Re-expand the sidebar and show the raw agent list"
              >
                Show sidebar ▸{" "}
                <span className="text-zinc-500">(legacy agent list / per-project shortcuts)</span>
              </button>
            )}

            <button
              type="button"
              onClick={onOpenSettings}
              className="block w-full rounded-md border border-white/5 bg-white/[0.02] px-3 py-2 text-left text-xs text-zinc-300 transition-colors hover:bg-white/[0.06]"
              title="Open Settings — orchestration / dispatch bundles still live here"
            >
              Open Settings ▸{" "}
              <span className="text-zinc-500">
                (orchestration rules, dispatch bundles, guardrails, …)
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
