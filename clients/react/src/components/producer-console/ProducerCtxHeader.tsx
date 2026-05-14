// ProducerCtxHeader — context-window usage strip for the active Producer.
//
// Renders the live ctx% / auto-handoff threshold readout from
// handoff-lifecycle DR §E:
//
//   ctx: 142k / 200k (71%) ▮▮▮▮▮▮▮░░░ │ auto-handoff at 75% ⚙
//
// Surfaces the same wire data the auto-handoff trigger fires on
// (`AgentSnapshot.ctx_usage.pct` vs `OrchestratorSettings
// .auto_handoff_threshold_pct`), so the operator can predict
// the trigger instead of being surprised by it.
//
// Producer scoping matches the `Handoff & restart` button
// (`ProducerConsoleActions.findProducerForUnit`): `claude:` id-scheme
// + `!is_worktree` + cwd resolves to the unit's repo path. The header
// always renders (fixed-height row) so swapping projects / waiting
// for the first statusline payload doesn't make the layout jump.

import { useEffect, useState } from "react";
import { type AgentSnapshot, api, normalizeGitDir } from "@/lib/api";

interface ProducerCtxHeaderProps {
  agents: AgentSnapshot[];
  /** Repo root for the currently focused unit. When null, no Producer
   *  can be resolved and the row renders its placeholder. */
  currentProjectPath: string | null;
  onOpenSettings: () => void;
}

const PRODUCER_ID_SCHEME = "claude:";

// Same filter rules as `ProducerConsoleActions.findProducerForUnit`,
// kept inline to avoid widening that module's export surface for what
// is essentially a one-call helper.
function findProducerForUnit(
  agents: AgentSnapshot[],
  unitRepoPath: string | null,
): AgentSnapshot | null {
  if (unitRepoPath === null) return null;
  const targetPath = normalizeGitDir(unitRepoPath);
  const candidates = agents.filter((a) => {
    if (!a.id.startsWith(PRODUCER_ID_SCHEME)) return false;
    if (a.is_worktree === true) return false;
    const agentRepo = a.git_common_dir ? normalizeGitDir(a.git_common_dir) : a.cwd;
    return agentRepo === targetPath;
  });
  return candidates.length === 1 ? (candidates[0] ?? null) : null;
}

// CC's statusline reports `total` and `used` as bigints (200_000-ish);
// `Nk` rounding keeps the row scannable. `Math.round` on bigint→number
// is safe here — context-window totals fit in `Number.MAX_SAFE_INTEGER`
// by orders of magnitude.
export function formatThousands(n: bigint): string {
  const k = Math.round(Number(n) / 1000);
  return `${k}k`;
}

// 10-segment bar where `pct=71` → 7 filled (▮) + 3 empty (░).
// `Math.round` chosen over `floor` so 65% reads as 7 segments and 64%
// reads as 6 — operator's eye expects "more than half" of the bar to
// flip near the visual midpoint.
export function renderBar(pct: number): { filled: number; empty: number; chars: string } {
  const clamped = Math.max(0, Math.min(100, pct));
  const filled = Math.max(0, Math.min(10, Math.round(clamped / 10)));
  const empty = 10 - filled;
  return {
    filled,
    empty,
    chars: "▮".repeat(filled) + "░".repeat(empty),
  };
}

// Threshold readout colour bands per the issue:
//   pct >= threshold        → red    (will trigger / has triggered)
//   threshold - 10 ≤ pct    → amber  ("within 10% of threshold")
//   else                    → zinc
// Threshold == 0 means auto-handoff is disabled — never colour the
// readout in that mode; the row instead labels it "disabled".
export function thresholdColorClass(pct: number | null, threshold: number): string {
  if (threshold <= 0) return "text-zinc-500";
  if (pct === null) return "text-zinc-500";
  if (pct >= threshold) return "text-red-300";
  if (pct >= threshold - 10) return "text-amber-300";
  return "text-zinc-400";
}

export function ProducerCtxHeader({
  agents,
  currentProjectPath,
  onOpenSettings,
}: ProducerCtxHeaderProps) {
  const producer = findProducerForUnit(agents, currentProjectPath);
  const ctx = producer?.ctx_usage ?? null;

  const [threshold, setThreshold] = useState<number | null>(null);

  // One-shot fetch on mount. The threshold rarely changes — when the
  // operator edits it in Settings, SettingsPanel persists via PUT
  // and the next mount picks up the new value. (Threshold edits are
  // not on the SSE entity-update fanout; a 30s reload window is fine.)
  // Re-fetch on currentProjectPath change so per-project overrides
  // (if landed later) flow through without a hard reload.
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
      ? "auto-handoff threshold: —"
      : effectiveThreshold === 0
        ? "auto-handoff: disabled"
        : `auto-handoff at ${effectiveThreshold}%`;
  const readoutColor = thresholdColorClass(ctx?.pct ?? null, effectiveThreshold);

  return (
    <div className="border-b border-white/5 bg-white/[0.02] px-6 py-2 text-xs">
      <div className="flex items-center gap-3 text-zinc-400">
        {ctx ? (
          <>
            <span className="font-mono text-zinc-300">
              ctx: <span className="text-zinc-200">{formatThousands(ctx.used)}</span>
              {" / "}
              <span className="text-zinc-200">{formatThousands(ctx.total)}</span>
              {" ("}
              <span className="text-zinc-200">{ctx.pct}%</span>
              {")"}
            </span>
            <span className="font-mono text-zinc-500" aria-hidden="true">
              {renderBar(ctx.pct).chars}
            </span>
          </>
        ) : (
          <span className="font-mono text-zinc-600">ctx: — / —</span>
        )}
        <span className="text-zinc-700" aria-hidden="true">
          │
        </span>
        <span className={`font-mono ${readoutColor}`}>{thresholdLabel}</span>
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label="Open settings — auto-handoff threshold"
          title="Open settings — auto-handoff threshold"
          className="ml-0 rounded text-zinc-500 transition-colors hover:text-zinc-200"
        >
          ⚙
        </button>
      </div>
    </div>
  );
}
