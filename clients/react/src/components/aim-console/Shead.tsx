// Shead — the aim-console's own per-session header bar (S6).
//
// Replaces the borrowed `ProducerConversationHeader` (Tailwind look) inside
// `SessionPane` with the design contract's `.shead`
// (`origin/mock/aim-ui-s6` → `assets/s6-conversation-panel-mock.html`):
// a single 27px mono-first bar in the dev-tool tokens.
//
//   Producer: dot · name · model · ctx bar (with the auto-handoff threshold
//             marker ┊) · pct · auto N% · unit/cwd · ⤺ handoff & restart ·
//             ⟳ restart   (⚙ Settings moved to the app top-bar — it is
//             app-level config, not a per-conversation control.)
//   Worker:   dot · name · model · ctx bar (violet accent) · pct ·
//             repo/cwd · ✕ kill
//
// REUSE, DON'T REBUILD (issue #803): the ctx readout reuses
// `ProducerCtxHeader`'s exported helpers (`formatThousands` / `renderBar` /
// `thresholdColorClass`, import-only) and the same one-shot
// `getProducerSettings` threshold fetch; the handoff button fires the
// SAME App-lifted ritual `trigger` with the SAME confirm flow as
// `ProducerConversationHeader` (which itself is untouched — the existing
// console keeps using it).

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useConfirm } from "@/components/layout/ConfirmDialog";
import {
  type AgentSnapshot,
  api,
  normalizeGitDir,
  type TriggerHandoffRitualRequest,
} from "@/lib/api";
import { formatThousands, renderBar, thresholdColorClass } from "@/lib/ctx-format";
import { cn } from "@/lib/utils";
import { statusClass, statusWord } from "./session-status";

interface SheadProps {
  /** The selected session agent this bar describes. */
  agent: AgentSnapshot;
  /** Producer variant (ctx threshold marker + handoff ritual)
   *  vs worker variant (repo/cwd + kill only). */
  isProducer: boolean;
  /** Unit name — keys the handoff ritual endpoint (Producer variant). */
  unitName: string | null;
  /** Repo root for the focused unit — scopes the threshold fetch
   *  (Producer variant; same contract as ProducerCtxHeader). */
  currentProjectPath: string | null;
  /** App-level lifted handoff ritual trigger (one `useHandoffRitual`
   *  instance, in App). */
  trigger: (unit: string, body: TriggerHandoffRitualRequest) => Promise<void>;
}

function repoBasename(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

// Best-effort kill — same shape as the existing console's handlers
// (swallow the error: an already-dead agent shouldn't throw to the operator).
function killAgent(target: string): void {
  api.killAgent(target).catch(() => {});
}

// Map `thresholdColorClass`'s Tailwind token names onto the aim-console's
// own tokens. The helper is reused for its BANDING (>= threshold / within
// 10% / calm — the same bands the auto-trigger fires on), not its class
// strings, which belong to the existing console's palette.
function pctToneClass(pct: number | null, threshold: number): string {
  const tone = thresholdColorClass(pct, threshold);
  if (tone === "text-destructive") return "hot";
  if (tone === "text-warning") return "hi";
  return "";
}

// The 10-segment ctx bar with the auto-handoff threshold marker `┊` spliced
// in at the threshold's segment boundary (75% → between segment 7 and 8).
// `markerIdx === null` (no/disabled threshold, worker variant) renders the
// bare bar.
function CtxBar({ pct, markerIdx }: { pct: number; markerIdx: number | null }) {
  const bar = renderBar(pct);
  const cells: ReactNode[] = [];
  for (let i = 0; i <= 10; i++) {
    if (markerIdx === i) {
      cells.push(
        <span key="tk" className="tk">
          ┊
        </span>,
      );
    }
    if (i < 10) {
      cells.push(
        <span key={i} className={i < bar.filled ? "f" : "e"}>
          {bar.chars[i]}
        </span>,
      );
    }
  }
  return (
    <span className="bar" aria-hidden="true">
      {cells}
    </span>
  );
}

function StatusDot({ attention }: { attention: AgentSnapshot["attention"] }) {
  const word = statusWord(attention);
  return (
    <span role="img" className={cn("dd", statusClass(attention))} title={word} aria-label={word} />
  );
}

// Plain kill — the WORKER header's terminal. Killing a worker is legitimate
// and bounded (nothing respawns it), so it stays a bare ✕ kill, no confirm.
// (The Producer header uses `RestartButton` instead — see below.)
function KillButton({ target }: { target: string }) {
  return (
    <button
      type="button"
      className="ic kill"
      onClick={() => killAgent(target)}
      title="Kill agent"
      aria-label="Kill agent"
    >
      ✕
    </button>
  );
}

// The PRODUCER header's RESTART affordance. With `unit ≡ live Producer` (aim
// `producer-slot-invariant` is `dead`) there is no slot-supervisor auto-respawn:
// killing the Producer just ends it. So restart is an explicit two-step — kill
// the current Producer, then relaunch a fresh one at the SAME locus (`agent.cwd`,
// the launch dir the unit derives from) via `POST /api/producer/launch`. The
// peer of ⤺ handoff: handoff carries a baton (context preserved), restart does
// NOT (context discarded), so it stays behind a danger confirm. The brief
// Producer-absent gap between kill and relaunch keeps the unit's tab focused —
// App's grace-window auto-default holds the selection (aim
// `handoff-producer-unit-focus`). The terminal (unit gone for good) remains the
// tab close `×` (`closeUnitSlot`), not this.
function RestartButton({ target, launchPath }: { target: string; launchPath: string }) {
  const confirm = useConfirm();
  const handleRestart = async () => {
    const ok = await confirm({
      title: "Restart this Producer?",
      message:
        "The current session is killed and a fresh Producer is launched at the same " +
        "location with NO hand-off — its conversation context is lost. Use Handoff & " +
        "restart (⤺) instead to preserve context.",
      confirmLabel: "Restart",
      cancelLabel: "Cancel",
      variant: "danger",
    });
    if (!ok) return;
    // Kill then relaunch at the same locus. Best-effort on both (an
    // already-gone agent / a transient launch hiccup shouldn't throw to the
    // operator); the tab is held across the gap by the focus grace window.
    await api.killAgent(target).catch(() => {});
    await api.launchProducer(launchPath).catch(() => {});
  };
  return (
    <button
      type="button"
      className="ic respawn"
      onClick={handleRestart}
      title="Restart Producer (kill + relaunch fresh; no hand-off)"
      aria-label="Restart Producer (kill + relaunch fresh; no hand-off)"
    >
      ⟳
    </button>
  );
}

export function Shead({ agent, isProducer, unitName, currentProjectPath, trigger }: SheadProps) {
  return isProducer ? (
    <ProducerShead
      agent={agent}
      unitName={unitName}
      currentProjectPath={currentProjectPath}
      trigger={trigger}
    />
  ) : (
    <WorkerShead agent={agent} />
  );
}

function ProducerShead({
  agent,
  unitName,
  currentProjectPath,
  trigger,
}: Omit<SheadProps, "isProducer">) {
  const ctx = agent.ctx_usage ?? null;
  const [threshold, setThreshold] = useState<number | null>(null);

  // One-shot fetch on mount, re-fetched on currentProjectPath change —
  // same contract as ProducerCtxHeader (threshold edits aren't on the
  // SSE fanout; the next mount picks up a new value).
  useEffect(() => {
    let cancelled = false;
    api
      .getProducerSettings(currentProjectPath ?? undefined)
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
    threshold === null ? "auto —" : effectiveThreshold === 0 ? "auto off" : `auto ${threshold}%`;
  // Threshold marker position: segment boundary nearest the threshold
  // (mirrors renderBar's `Math.round` segment rule). Hidden when disabled.
  const markerIdx =
    effectiveThreshold > 0 ? Math.max(0, Math.min(10, Math.round(effectiveThreshold / 10))) : null;

  const handleHandoff = () => {
    if (unitName === null) return;
    const ok = window.confirm(
      "Kill the current Producer and start a fresh one bridged via hand-off?",
    );
    if (!ok) return;
    void trigger(unitName, { trigger: "manual" });
  };

  return (
    <div className="ac-shead ac-who-p" data-testid="ac-shead-producer">
      <StatusDot attention={agent.attention} />
      <span className="nm">{agent.display_name}</span>
      <span className="md">{agent.model_display_name ?? agent.model_id ?? "—"}</span>
      {ctx ? (
        <>
          <CtxBar pct={ctx.pct} markerIdx={markerIdx} />
          <span
            className={cn("pct", pctToneClass(ctx.pct, effectiveThreshold))}
            title={`ctx: ${formatThousands(ctx.used)} / ${formatThousands(ctx.total)} (${ctx.pct}%)`}
          >
            {ctx.pct}%
          </span>
        </>
      ) : (
        <span className="pct" title="ctx: — / —">
          —
        </span>
      )}
      <span className="md">{thresholdLabel}</span>
      <span className="cwd">
        unit {unitName ?? "—"} · cwd {agent.display_cwd}
      </span>
      <span className="acts">
        <button
          type="button"
          className="ho"
          onClick={handleHandoff}
          disabled={unitName === null}
          title={
            unitName === null
              ? "No unit in focus"
              : "Kill the current Producer and start a fresh one, bridged via a hand-off file"
          }
        >
          ⤺ handoff &amp; restart
        </button>
        <RestartButton target={agent.target} launchPath={agent.cwd} />
      </span>
    </div>
  );
}

function WorkerShead({ agent }: { agent: AgentSnapshot }) {
  const ctx = agent.ctx_usage ?? null;
  return (
    <div className="ac-shead ac-who-w" data-testid="ac-shead-worker">
      <StatusDot attention={agent.attention} />
      <span className="nm">{agent.display_name}</span>
      <span className="md">{agent.model_display_name ?? agent.model_id ?? "—"}</span>
      {ctx && (
        <>
          <CtxBar pct={ctx.pct} markerIdx={null} />
          <span
            className="pct"
            title={`ctx: ${formatThousands(ctx.used)} / ${formatThousands(ctx.total)} (${ctx.pct}%)`}
          >
            {ctx.pct}%
          </span>
        </>
      )}
      <span className="cwd">
        {/* normalizeGitDir first — `git_common_dir` is the `/.git` dir on the
            wire, and its bare basename would read "repo .git". */}
        repo {repoBasename(normalizeGitDir(agent.git_common_dir ?? agent.cwd))}
        {agent.git_branch ? ` · ${agent.git_branch}` : ""} · {agent.display_cwd}
      </span>
      <span className="acts">
        <KillButton target={agent.target} />
      </span>
    </div>
  );
}
