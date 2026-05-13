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
// 3. **Operator override ▾** — Phase A stub. Phase B will demote the
//    legacy orchestrator-era controls (NewAgentLauncher, manual
//    dispatch buttons, direct prompt input, OrchestrationSection)
//    behind this expandable. For now it tells the operator the move
//    is planned but not yet built — keeps the slot visible without
//    promising a feature that doesn't exist.

import type { CalibrationResponse } from "@/lib/api";

interface ProducerConsoleActionsProps {
  unitName: string | null;
  calibrationData: CalibrationResponse | null;
  onOpenProducerTerminal: () => void;
  onOpenCalibration: () => void;
}

export function ProducerConsoleActions({
  unitName,
  calibrationData,
  onOpenProducerTerminal,
  onOpenCalibration,
}: ProducerConsoleActionsProps) {
  const tripwireCount = calibrationData?.tier1_violations.length ?? 0;
  const calCount = calibrationData?.total_in_window ?? 0;

  return (
    <div className="flex items-center gap-2 border-t border-white/5 px-6 py-3">
      <button
        type="button"
        onClick={onOpenProducerTerminal}
        disabled={unitName === null}
        className="rounded-md bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-300 transition-colors hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-50"
        title={
          unitName === null
            ? "No unit resolvable yet — select a project first"
            : `Copy "tmai producer ${unitName}" to clipboard`
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

      <span
        className="ml-auto cursor-not-allowed rounded-md bg-white/[0.02] px-3 py-1.5 text-xs text-zinc-500"
        title="Phase B will demote legacy orchestrator-era controls (manual spawn, dispatch buttons, direct prompt input) behind this expandable."
      >
        Operator override ▾ <span className="text-[10px] uppercase tracking-wider">phase B</span>
      </span>
    </div>
  );
}
