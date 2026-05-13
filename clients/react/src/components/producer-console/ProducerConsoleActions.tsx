// Bottom action row of the Producer console.
//
// Three affordances, left-to-right:
//
// 1. **Open Producer terminal ▸** — spawns `tmai producer <unit>` via
//    `api.spawnPty` (`tmai-core/src/producer_cli.rs::launch_producer`
//    exec-style replaces tmai with a seeded Claude session). The
//    button is **always enabled**:
//    - If `unitName` is already resolved (operator has a focused
//      project), it delegates to `onOpenProducerTerminal`, which
//      spawns immediately.
//    - If not (first launch / no live agents), it opens an inline
//      DirBrowser so the operator can pick a repo root. The picked
//      path is forwarded to `onLaunchProducerAt`, which derives the
//      unit name from its basename and spawns there — App.tsx also
//      sets `currentProject` so the next click skips the picker.
//    First-dogfood blocker: the button used to disable itself when
//    `unitName === null`, but `unitName` derives from the *active
//    agents*' projects — chicken-and-egg on a clean start. This
//    revision unblocks it.
//
// 2. **Calibration ▸** — jumps into the existing `<CalibrationPanel>`
//    (PR #671). Disabled when `unitName === null` because the
//    calibration endpoint needs an explicit unit.
//
// 3. **Operator override ▾** — expandable panel hosting the legacy
//    spawn path (`NewAgentLauncher`), a Show-sidebar affordance when
//    the sidebar is collapsed, and an Open-Settings deep-link into
//    the Advanced section. Per `feedback_pty_emergency_terminal_
//    access` we keep this path — just route it off the main flow.

import { useCallback, useEffect, useState } from "react";
import { DirBrowser } from "@/components/project/DirBrowser";
import { NewAgentLauncher } from "@/components/project/NewAgentLauncher";
import { api, type CalibrationResponse } from "@/lib/api";

interface ProducerConsoleActionsProps {
  unitName: string | null;
  calibrationData: CalibrationResponse | null;
  /** Spawn the Producer using the already-selected project. */
  onOpenProducerTerminal: () => void;
  /** Spawn the Producer at an explicit repo root — used after the
   *  DirBrowser picks a path. */
  onLaunchProducerAt: (path: string) => void;
  onOpenCalibration: () => void;
  /** Spawn callback for the operator-override NewAgentLauncher. */
  onOverrideSpawned: (sessionId: string) => void;
  onOpenSidebar: () => void;
  sidebarCollapsed: boolean;
  onOpenSettings: () => void;
}

export function ProducerConsoleActions({
  unitName,
  calibrationData,
  onOpenProducerTerminal,
  onLaunchProducerAt,
  onOpenCalibration,
  onOverrideSpawned,
  onOpenSidebar,
  sidebarCollapsed,
  onOpenSettings,
}: ProducerConsoleActionsProps) {
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [defaultRoot, setDefaultRoot] = useState<string | null>(null);
  const tripwireCount = calibrationData?.tier1_violations.length ?? 0;
  const calCount = calibrationData?.total_in_window ?? 0;

  // Same pattern as NewAgentLauncher: pull `[general] default_project_
  // root` lazily on open so an edit in GeneralSection flips the picker
  // on the next launch without a reload. Read-only here, so a transient
  // fetch failure just leaves `defaultRoot = null` and DirBrowser falls
  // back to `~`.
  const refreshDefaultRoot = useCallback(async () => {
    try {
      const g = await api.getGeneralSettings();
      setDefaultRoot(g.default_project_root);
    } catch {
      // intentional no-op — see comment above.
    }
  }, []);
  useEffect(() => {
    void refreshDefaultRoot();
  }, [refreshDefaultRoot]);

  const handleProducerClick = useCallback(() => {
    if (unitName !== null) {
      onOpenProducerTerminal();
      return;
    }
    void refreshDefaultRoot();
    setBrowsing(true);
  }, [unitName, onOpenProducerTerminal, refreshDefaultRoot]);

  const handlePickPath = useCallback(
    (path: string) => {
      setBrowsing(false);
      onLaunchProducerAt(path);
    },
    [onLaunchProducerAt],
  );

  return (
    <div className="border-t border-white/5">
      <div className="flex items-center gap-2 px-6 py-3">
        <button
          type="button"
          onClick={handleProducerClick}
          className="rounded-md bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-300 transition-colors hover:bg-cyan-500/20"
          title={
            unitName === null
              ? "Pick a repo root and launch the Producer there"
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
              ? "No unit resolvable yet — launch the Producer (or pick a project) first"
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

      {browsing && (
        <DirBrowser
          startPath={defaultRoot ?? undefined}
          onCancel={() => setBrowsing(false)}
          actionSlot={(currentPath) => (
            <div className="flex w-full flex-col gap-1.5">
              <button
                type="button"
                onClick={() => handlePickPath(currentPath)}
                disabled={!currentPath}
                className="w-full rounded bg-cyan-500/10 px-3 py-1.5 text-center text-xs text-cyan-300 transition-colors hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Launch Producer here ▸
              </button>
              <p className="text-[10px] text-zinc-600">
                tmai will spawn{" "}
                <code className="text-zinc-500">tmai producer &lt;basename&gt;</code> in this
                directory.
              </p>
            </div>
          )}
        />
      )}
    </div>
  );
}
