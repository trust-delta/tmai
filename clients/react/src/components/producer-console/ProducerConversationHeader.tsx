// Conversation-view header for the active Producer — a SINGLE compact bar.
//
// Co-visible affordance (DR `2026-05-14-react-producer-console-rebuild.md`
// — the L/C/R co-visible principle): when the operator is *conversing*
// with the Producer in the centre pane, the digest's Handoff & restart
// trigger and ctx% readout used to be unreachable (they lived only in
// the hand-over digest), which trapped the operator into a manual kill
// (lived friction 2026-05-23). #725 lifted both into the conversation,
// ABOVE the terminal.
//
// Density refinement (lived friction 2026-05-23, operator at the
// screen): the Producer conversation stacked THREE bars — AgentActions
// (name + status pill + Kill), this ctx% strip, and the TerminalPanel id
// row. This bar now subsumes AgentActions for the Producer too: it
// carries the status dot + name + Kill alongside the ctx% readout and
// the Handoff trigger, so the conversation pane gets the height back.
// App renders ONLY this bar for the Producer (no separate AgentActions);
// the slim `provisional:…` id row beneath belongs to TerminalPanel.
//
// It renders ONLY when the selected agent IS this unit's Producer; the
// gate lives in `App.tsx` (`selectedAgent.target === producerForUnit?.target`
// — compared on the stable PTY `target`, not `id`, since `id` can re-key
// provisional→canonical and momentarily mis-classify the Producer as a
// worker at that boundary), so when the operator is talking to a worker
// this component is never mounted (workers keep their `<AgentActions>` bar).
//
// The ctx readout reuses `ProducerCtxHeader`'s exported helpers
// (`formatThousands` / `renderBar` / `thresholdColorClass`) and the same
// threshold fetch (`getOrchestratorSettings`); the digest keeps the
// full-form `ProducerCtxHeader`. The status dot reuses AgentActions'
// `attention`→colour/label mapping. The Handoff button fires the
// App-level lifted ritual via `trigger` — there is exactly one
// `useHandoffRitual` instance, in App.

import { useEffect, useState } from "react";
import { type AgentSnapshot, api, type TriggerHandoffRitualRequest } from "@/lib/api";
import { findProducerForUnit } from "@/lib/producer";
import { cn } from "@/lib/utils";
import type { UnitRepoWire } from "@/types/generated/UnitRepoWire";
import { formatThousands, renderBar, thresholdColorClass } from "./ProducerCtxHeader";

interface ProducerConversationHeaderProps {
  agents: AgentSnapshot[];
  /** Repo root for the currently focused unit — drives the ctx readout
   *  and the single-Producer resolution. */
  currentProjectPath: string | null;
  /** The focused unit's MEMBERSHIP wire (primary-first per
   *  `UnitRepoWire.primary`), threaded from App's `unitReposForCurrent`.
   *  When present the resolver pins the Producer to the unit's PRIMARY repo
   *  even if `currentProjectPath` points at a secondary repo — the same
   *  wire-read App's own `producerForUnit` uses (#583 §軸A). `null` (wire not
   *  yet loaded, or a cwd-synthesized unit) falls back to `currentProjectPath`. */
  unitRepos?: UnitRepoWire[] | null;
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
  unitRepos,
  trigger,
  onOpenSettings,
}: ProducerConversationHeaderProps) {
  // Resolve the single live Producer via the shared resolver — the same
  // one the digest button and the ctx readout use, so all surfaces agree.
  // Prefer the membership wire (primary-pinned) over the single cwd path.
  const producer = findProducerForUnit(agents, unitRepos ?? currentProjectPath);
  const ctx = producer?.ctx_usage ?? null;
  const disabled = producer === null || unitName === null;

  // Status dot — reuse AgentActions' flat `attention` enum mapping
  // (tmai-core@2026-05-09 Phase 4): `"halted"` → destructive (at a
  // permission prompt), `"started"|"completed"` → muted (waiting on the
  // operator), `null` → primary (running). The word rides in the dot's
  // title so the colour stays glanceable without a separate pill.
  const attention = producer?.attention ?? null;
  const statusWord =
    attention === "halted"
      ? "Halted"
      : attention === "completed"
        ? "Done"
        : attention === "started"
          ? "Started"
          : "Active";
  const dotColor =
    attention === "halted"
      ? "text-destructive"
      : attention === "started" || attention === "completed"
        ? "text-muted-foreground"
        : "text-primary";

  const [threshold, setThreshold] = useState<number | null>(null);

  // One-shot fetch on mount, re-fetched on currentProjectPath change —
  // same contract as ProducerCtxHeader (threshold edits aren't on the
  // SSE fanout; the next mount picks up a new value).
  useEffect(() => {
    let cancelled = false;
    api
      .getOrchestratorSettings(currentProjectPath ?? undefined)
      .then((s) => {
        if (!cancelled) setThreshold(s.auto_handoff_threshold_pct);
      })
      .catch(() => {
        if (!cancelled) setThreshold(null);
      });
    return () => {
      cancelled = true;
    };
  }, [currentProjectPath]);

  const effectiveThreshold = threshold ?? 0;
  const thresholdLabel =
    threshold === null
      ? "auto@—"
      : effectiveThreshold === 0
        ? "auto: off"
        : `auto@${effectiveThreshold}%`;
  const readoutColor = thresholdColorClass(ctx?.pct ?? null, effectiveThreshold);

  const handleHandoffClick = () => {
    // Defensive: App only mounts this header when a Producer is
    // resolved, but keep the guard so the confirm can't fire with no
    // target.
    if (disabled) return;
    const ok = window.confirm(
      "Kill the current Producer and start a fresh one bridged via hand-off?",
    );
    if (!ok) return;
    void trigger(unitName, { trigger: "manual" });
  };

  // Best-effort kill — reuses AgentActions' handler shape (swallow the
  // error: an already-dead agent shouldn't throw to the operator).
  const handleKill = async () => {
    if (producer === null) return;
    try {
      await api.killAgent(producer.target);
    } catch (_e) {}
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-hairline bg-surface px-3 py-1.5 text-xs">
      <span
        // `role="img"` so the colour-coded glyph announces its state to
        // screen readers via `aria-label` (colour + `title` alone aren't
        // reliably announced).
        role="img"
        className={cn("shrink-0 text-sm leading-none", dotColor)}
        title={statusWord}
        aria-label={statusWord}
      >
        ●
      </span>
      <span className="truncate text-sm font-medium text-foreground">
        {producer?.display_name ?? "Producer"}
      </span>

      {ctx ? (
        <span
          className="flex items-center gap-1.5 font-mono"
          title={`ctx: ${formatThousands(ctx.used)} / ${formatThousands(ctx.total)} (${ctx.pct}%)`}
        >
          <span className="text-foreground">{ctx.pct}%</span>
          <span className="text-muted-foreground" aria-hidden="true">
            {renderBar(ctx.pct).chars}
          </span>
        </span>
      ) : (
        <span className="font-mono text-subtle-foreground" title="ctx: — / —">
          —
        </span>
      )}
      <span className={cn("font-mono", readoutColor)}>{thresholdLabel}</span>

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={handleHandoffClick}
          disabled={disabled}
          className="rounded-md bg-surface-strong px-3 py-1 text-xs text-foreground transition-colors hover:bg-surface-strong/70 disabled:cursor-not-allowed disabled:opacity-50"
          title={
            disabled
              ? "No live Producer for this unit"
              : "Kill the current Producer and start a fresh one, bridged via a hand-off file"
          }
        >
          Handoff &amp; restart ▸
        </button>
        <button
          type="button"
          onClick={handleKill}
          disabled={producer === null}
          className="touch-target-sm rounded-md px-2 py-1 text-xs text-subtle-foreground transition-colors hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
          title="Kill agent"
        >
          Kill
        </button>
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label="Open settings — auto-handoff threshold"
          title="Open settings — auto-handoff threshold"
          className="rounded text-muted-foreground transition-colors hover:text-foreground"
        >
          ⚙
        </button>
      </div>
    </div>
  );
}
