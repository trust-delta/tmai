// Producer console — the default main view per
// `doc/decisions/2026-05-14-react-producer-console-rebuild.md`.
//
// Composition mirrors the Producer's session-start hand-over digest:
//
//   ▶ Where you left off
//   ⬢ Cross-unit status
//   ⬡ Settled decisions      (wired to GET /api/units/{unit}/decisions)
//   ◐ Working with this human (Phase A placeholder)
//
// Bottom row offers two real actions and one Phase-B stub. The
// tier-1 tripwire banner is hoisted by `App.tsx` above the entire
// main-pane swap (so it persists across Settings / Calibration /
// agent views too) — this component intentionally does NOT render
// its own tripwire band to avoid a duplicate alarm.
//
// Producer conversation runs in-tmai via `spawnPty("tmai", ["producer",
// unit])` — `tmai producer` `exec`s into a Claude session seeded with
// the unit's hand-over (`tmai-core/src/producer_cli.rs::launch_producer`),
// so from the PTY-server's perspective the Producer is just a normal
// agent spawn. After spawn, App.tsx's `openProducerTerminal` selects
// the new session and the main pane switches to its PreviewPanel — no
// external-terminal round-trip.

import { useAgents } from "@/hooks/useAgents";
import { useHandover } from "@/hooks/useHandover";
import type { CalibrationResponse } from "@/lib/api";
import { ProducerConsoleActions } from "./ProducerConsoleActions";
import { ProducerCtxHeader } from "./ProducerCtxHeader";
import { CrossUnitStatusSection } from "./sections/CrossUnitStatusSection";
import { SettledDecisionsSection } from "./sections/SettledDecisionsSection";
import { WhereYouLeftOffSection } from "./sections/WhereYouLeftOffSection";
import { WorkingWithThisHumanSection } from "./sections/WorkingWithThisHumanSection";

interface ProducerConsoleProps {
  /** Currently focused project (from App.tsx's `currentProject` state).
   *  Drives the ▶ Where-you-left-off section and the unit for the
   *  Producer-terminal command. */
  currentProjectPath: string | null;
  /** Unit name — basename of `currentProjectPath`. The backend's
   *  `resolve_unit_or_cwd` accepts this and falls back to the cwd
   *  if no matching `[[unit]]` is configured. */
  unitName: string | null;
  /** Calibration response from the parent (App.tsx already polls);
   *  reused here for the footer's calibration-jump badge. */
  calibrationData: CalibrationResponse | null;
  onOpenProducerTerminal: () => void;
  /** Phase B polish v3: invoked from the DirBrowser path when the
   *  operator hasn't selected a project yet. `path` is a repo root;
   *  App.tsx derives the unit name from its basename and spawns
   *  `tmai producer` there. */
  onLaunchProducerAt: (path: string) => void;
  onOpenCalibration: () => void;
  /** Click handler for the cross-unit list — wired to App.tsx's
   *  `handleSelectProject` so unit selection here matches sidebar
   *  selection there. */
  onSelectProjectByPath: (path: string, name: string) => void;
  /** Phase B: operator-override callbacks. The override expandable
   *  in the footer needs to spawn agents (re-using `NewAgentLauncher`),
   *  re-expand the (now default-collapsed) sidebar, and deep-link
   *  into the Settings page where orchestration / dispatch-bundle
   *  config still lives. All three are pass-through to App.tsx
   *  handlers — the console is purely a routing surface. */
  onOverrideSpawned: (sessionId: string) => void;
  onOpenSidebar: () => void;
  sidebarCollapsed: boolean;
  onOpenSettings: () => void;
}

export function ProducerConsole({
  currentProjectPath,
  unitName,
  calibrationData,
  onOpenProducerTerminal,
  onLaunchProducerAt,
  onOpenCalibration,
  onSelectProjectByPath,
  onOverrideSpawned,
  onOpenSidebar,
  sidebarCollapsed,
  onOpenSettings,
}: ProducerConsoleProps) {
  const { whereYouLeftOff, crossUnit, workingWithHuman, missingPreconditions } =
    useHandover(currentProjectPath);
  const { agents } = useAgents();

  return (
    <div className="flex flex-1 flex-col overflow-hidden animate-fade-in">
      <ProducerCtxHeader
        agents={agents}
        currentProjectPath={currentProjectPath}
        onOpenSettings={onOpenSettings}
      />
      <header className="border-b border-white/5 px-6 py-4">
        <h2 className="text-lg font-semibold text-zinc-200">Welcome to tmai</h2>
        <p className="mt-1 text-xs text-zinc-400">
          tmai routes your work through a <strong className="text-cyan-300">Producer</strong> — one
          CC session per project that reads your decisions / memory, briefs you on what needs
          attention, and dispatches workers. You talk to the Producer, not to individual agents.
        </p>
        <p className="mt-2 text-xs text-zinc-500">
          <span className="text-zinc-400">Quick start:</span>{" "}
          <strong className="text-zinc-300">①</strong> Read the digest below.{" "}
          <strong className="text-zinc-300">②</strong> Click{" "}
          <span className="text-cyan-300">Open Producer terminal</span> at the bottom — tmai spawns
          the Producer session and switches this pane to it.{" "}
          <strong className="text-zinc-300">③</strong> The Producer reads your context and briefs
          you on what to look at first; you converse with it right here.
        </p>
        <p className="mt-1.5 text-[11px] text-zinc-600">
          Need direct agent control (legacy)?{" "}
          <span className="text-zinc-500">Operator override</span> at the bottom · expandable
          sidebar on the left.
        </p>
      </header>

      <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5 text-sm">
        <WhereYouLeftOffSection data={whereYouLeftOff} />
        <CrossUnitStatusSection
          data={crossUnit}
          activePath={currentProjectPath}
          onSelectUnit={onSelectProjectByPath}
          preconditions={missingPreconditions}
        />
        <SettledDecisionsSection unitName={unitName} />
        <WorkingWithThisHumanSection data={workingWithHuman} />
      </div>

      <ProducerConsoleActions
        unitName={unitName}
        currentProjectPath={currentProjectPath}
        agents={agents}
        calibrationData={calibrationData}
        onOpenProducerTerminal={onOpenProducerTerminal}
        onLaunchProducerAt={onLaunchProducerAt}
        onOpenCalibration={onOpenCalibration}
        onOverrideSpawned={onOverrideSpawned}
        onOpenSidebar={onOpenSidebar}
        sidebarCollapsed={sidebarCollapsed}
        onOpenSettings={onOpenSettings}
      />
    </div>
  );
}
