// SessionPane — the centre Session conversation pane of the aim-console (S3).
//
// A faithful reproduction of the mock's `.session` section
// (`origin/mock/aim-ui-sample` → `assets/ui-sample.html`): session tabs
// (`.stabs`), the `.shead` (model / cwd / Handoff), and the `.term`
// conversation view — in the aim-console dev-tool tokens (`.ac-stabs` /
// `.ac-stab` / `.ac-ro`, extended from S1's stub). The mock's docked
// `.footer` (tabbed bash terminals) lands at the bottom as `<BashFooter>`
// (S4) — the strip S3 reserved is now the real docked bash footer.
//
// REUSE, DON'T REBUILD (issue #797): the existing console already renders
// agent conversations. This pane wires the SAME infra into the aim-console:
//   - session tabs ← the live agent list (Producer via `findProducerForUnit`
//     + the unit's workers);
//   - shead ← the aim-console's own `Shead` (S6) — Producer variant carries
//     the ctx bar + threshold marker + the App-lifted Handoff & restart
//     ritual; worker variant the model / repo / cwd line;
//   - term ← `WireTerminal` (S6: spine + chromeless `TerminalPanel` +
//     status strip — the hot/cold-wire control surface) for a live PTY /
//     `PreviewPanel` (between selections), UNCHANGED.
//
// The aim console is a full-screen TAKEOVER (App renders ONLY `<AimConsole>`
// in aim mode), so the selected SESSION is LOCAL state here — NOT App's
// main-pane selection. `agents` / `trigger` / `unitName` / `currentProjectPath`
// / `onOpenSettings` are threaded in from App (the aim-console's own wiring);
// the existing console still consumes them exactly as before.

import { useMemo, useState } from "react";
import { PreviewPanel } from "@/components/agent/PreviewPanel";
import {
  type AgentSnapshot,
  isAiAgentLoose,
  normalizeGitDir,
  type TriggerHandoffRitualRequest,
} from "@/lib/api";
import { findProducerForUnit } from "@/lib/producer";
import { cn } from "@/lib/utils";
import type { UnitRepoWire } from "@/types/generated/UnitRepoWire";
import { BashFooter } from "./BashFooter";
import { Shead } from "./Shead";
import { statusClass, statusWord } from "./session-status";
import { WireTerminal } from "./WireTerminal";

interface SessionPaneProps {
  /** Live agent list (App's `useAgents`). The Producer is resolved via
   *  `findProducerForUnit`; the rest of this unit's AI agents are workers. */
  agents: AgentSnapshot[];
  /** Unit name (basename of `currentProjectPath`) — scopes the worker tabs
   *  and keys the handoff ritual endpoint. */
  unitName: string | null;
  /** Primary repo path for the focused unit — resolves the single Producer
   *  and the back-compat (no-`unit`-field) worker scope. */
  currentProjectPath: string | null;
  /** App-level lifted handoff ritual trigger (one `useHandoffRitual`
   *  instance, in App). Threaded straight into `ProducerConversationHeader`. */
  trigger: (unit: string, body: TriggerHandoffRitualRequest) => Promise<void>;
  /** ⚙ deep-link into Settings (auto-handoff threshold). */
  onOpenSettings: () => void;
  /** The focused unit's repos (primary first), threaded from AimConsole's
   *  membership list — one per-repo bash tab each in the docked footer (S4).
   *  Empty for a cwd-synthesized unit not in the configured membership; the
   *  footer then falls back to `currentProjectPath`. */
  repos: UnitRepoWire[];
}

// Does this agent belong to the focused unit? Prefer the wire `unit` field
// (a `[[unit]]` can span several repos, so a worker at a SECONDARY repo still
// carries the unit's name — #439); fall back to a primary-repo-dir match for
// an engine not yet rebuilt to serve `unit` (the same transition window
// `groupByProject` handles).
function agentInUnit(
  agent: AgentSnapshot,
  unitName: string | null,
  primaryPath: string | null,
): boolean {
  if (agent.unit && agent.unit.length > 0) {
    return unitName !== null && agent.unit === unitName;
  }
  if (primaryPath === null) return false;
  return normalizeGitDir(agent.git_common_dir ?? agent.cwd) === normalizeGitDir(primaryPath);
}

export function SessionPane({
  agents,
  unitName,
  currentProjectPath,
  trigger,
  onOpenSettings,
  repos,
}: SessionPaneProps) {
  // Producer + workers for the focused unit. The Producer (if any) leads;
  // workers follow, sorted by name for a stable tab order. Resolution mirrors
  // the existing console exactly (same `findProducerForUnit`), so both
  // surfaces agree on who the Producer is.
  const { producer, sessionAgents } = useMemo(() => {
    const prod = findProducerForUnit(agents, currentProjectPath);
    const unitAgents = agents
      .filter(isAiAgentLoose)
      .filter((a) => agentInUnit(a, unitName, currentProjectPath));
    const workers = unitAgents
      .filter((a) => a.target !== prod?.target)
      .sort((a, b) => a.display_name.localeCompare(b.display_name));
    return { producer: prod, sessionAgents: prod ? [prod, ...workers] : workers };
  }, [agents, unitName, currentProjectPath]);

  // Local selected SESSION — independent of App's main-pane selection, since
  // the aim console is a full-screen takeover. `null` falls through to the
  // first tab; a stale target (the session went away) does the same.
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const effectiveTarget = useMemo(() => {
    if (selectedTarget && sessionAgents.some((a) => a.target === selectedTarget)) {
      return selectedTarget;
    }
    return sessionAgents[0]?.target ?? null;
  }, [selectedTarget, sessionAgents]);
  const selectedAgent = sessionAgents.find((a) => a.target === effectiveTarget) ?? null;
  const isProducerSelected = selectedAgent !== null && selectedAgent.target === producer?.target;

  return (
    <>
      {/* ── session tabs (mock `.stabs`) ── */}
      <div className="ac-stabs" role="tablist" aria-label="Sessions">
        {sessionAgents.map((a) => {
          const isProd = a.target === producer?.target;
          const selected = a.target === effectiveTarget;
          return (
            <button
              key={a.target}
              type="button"
              role="tab"
              aria-selected={selected}
              className={cn("ac-stab", selected && "on")}
              onClick={() => setSelectedTarget(a.target)}
              title={`${isProd ? "Producer" : "worker"}: ${a.display_name} — ${statusWord(a.attention)}`}
            >
              <span className={cn("ac-ro", isProd ? "p" : "w")}>{isProd ? "PROD" : "WRK"}</span>
              <span className="ac-stab-name">{a.display_name}</span>
              <span
                className={cn("ac-sdot", statusClass(a.attention))}
                aria-hidden="true"
                title={statusWord(a.attention)}
              />
            </button>
          );
        })}
        {/* Worker dispatch affordance. Dispatch is an existing capability, not
            S3 work — rendered faithfully (mock `.sadd`) but inert here. */}
        <span className="ac-sadd" title="worker dispatch (existing capability)" aria-hidden="true">
          +
        </span>
      </div>

      {/* ── shead (mock `.shead`) ── the aim-console's own S6 bar: Producer
          variant carries the ctx bar + ┊ threshold marker + the Handoff &
          restart ritual; worker variant the model / repo / cwd line. */}
      {selectedAgent && (
        <Shead
          agent={selectedAgent}
          isProducer={isProducerSelected}
          unitName={unitName}
          currentProjectPath={currentProjectPath}
          trigger={trigger}
          onOpenSettings={onOpenSettings}
        />
      )}

      {/* ── term (mock `.term`) ── the raw-CC conversation. Live PTY →
          WireTerminal (S6 spine + chromeless TerminalPanel + status strip,
          accent = addressee); between selections (no live PTY) →
          PreviewPanel, UNCHANGED. */}
      <div className="ac-term">
        {selectedAgent ? (
          selectedAgent.pty_session_id ? (
            <WireTerminal
              key={selectedAgent.target}
              agentId={selectedAgent.target}
              who={isProducerSelected ? "producer" : "worker"}
              addressee={isProducerSelected ? "producer" : selectedAgent.display_name}
              ctxPct={selectedAgent.ctx_usage?.pct ?? null}
              hint
            />
          ) : (
            <PreviewPanel key={selectedAgent.target} agentId={selectedAgent.target} />
          )
        ) : (
          <div className="ac-term-empty">
            No active session for this unit — launch a Producer or dispatch a worker.
          </div>
        )}
      </div>

      {/* ── docked bash footer (mock `.footer`) ── per-repo + ad-hoc shell
          terminals, lazy-spawned on first activation and rendered via the
          reused TerminalPanel. Collapsed by default (S3 reserved this strip;
          S4 fills it). */}
      <BashFooter repos={repos} primaryPath={currentProjectPath} agents={agents} />
    </>
  );
}
