// Conversation-view header for the active Producer.
//
// Co-visible affordance (DR `2026-05-14-react-producer-console-rebuild.md`
// — the L/C/R co-visible principle): when the operator is *conversing*
// with the Producer in the centre pane, the digest's Handoff & restart
// trigger and ctx% readout used to be unreachable (they lived only in
// the hand-over digest), which trapped the operator into a manual kill
// (lived friction 2026-05-23). This strip lifts both into the
// conversation, ABOVE the terminal.
//
// It renders ONLY when the selected agent IS this unit's Producer; the
// gate lives in `App.tsx` (`selectedAgent.id === producerForUnit?.id`),
// so when the operator is talking to a worker this component is never
// mounted.
//
// The ctx% readout reuses `ProducerCtxHeader` verbatim (same
// `formatThousands` / `renderBar` / `thresholdColorClass`); the
// `Handoff & restart ▸` button rides in its `actionSlot`. The button
// fires the App-level lifted ritual via the `trigger` prop — there is
// exactly one `useHandoffRitual` instance, in App.

import type { AgentSnapshot, TriggerHandoffRitualRequest } from "@/lib/api";
import { findProducerForUnit } from "@/lib/producer";
import { ProducerCtxHeader } from "./ProducerCtxHeader";

interface ProducerConversationHeaderProps {
  agents: AgentSnapshot[];
  /** Repo root for the currently focused unit — drives the ctx readout
   *  and the single-Producer resolution. */
  currentProjectPath: string | null;
  /** Unit name (basename of `currentProjectPath`) — the handoff ritual
   *  endpoint keys on it. */
  unitName: string | null;
  /** The App-level lifted ritual trigger. The button does the confirm
   *  then calls this; the overlay / failure dialog / ready-toast all
   *  render at App level off the same single hook instance. */
  trigger: (unit: string, body: TriggerHandoffRitualRequest) => Promise<void>;
  /** ⚙ deep-link into Settings (auto-handoff threshold lives there). */
  onOpenSettings: () => void;
}

export function ProducerConversationHeader({
  agents,
  currentProjectPath,
  unitName,
  trigger,
  onOpenSettings,
}: ProducerConversationHeaderProps) {
  // Resolve the single live Producer via the shared resolver — the same
  // one the digest button and the ctx readout use, so all three agree.
  const producer = findProducerForUnit(agents, currentProjectPath);

  const handleHandoffClick = () => {
    // Defensive: App only mounts this header when a Producer is
    // resolved, but keep the guard so the confirm can't fire with no
    // target.
    if (producer === null || unitName === null) return;
    const ok = window.confirm(
      "Kill the current Producer and start a fresh one bridged via hand-off?",
    );
    if (!ok) return;
    void trigger(unitName, { trigger: "manual" });
  };

  return (
    <ProducerCtxHeader
      agents={agents}
      currentProjectPath={currentProjectPath}
      onOpenSettings={onOpenSettings}
      actionSlot={
        <button
          type="button"
          onClick={handleHandoffClick}
          disabled={producer === null || unitName === null}
          className="rounded-md bg-surface px-3 py-1 text-xs text-foreground transition-colors hover:bg-surface-strong disabled:cursor-not-allowed disabled:opacity-50"
          title={
            producer === null || unitName === null
              ? "No live Producer for this unit"
              : "Kill the current Producer and start a fresh one, bridged via a hand-off file"
          }
        >
          Handoff &amp; restart ▸
        </button>
      }
    />
  );
}
