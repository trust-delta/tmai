// Worker-session header (C3, Stage C aim-console convergence).
//
// A worker session's terminal panel used to show only its agent id. This
// header mirrors the Producer's `ProducerConversationHeader` for any
// session — model + cwd + a context-% readout — so a worker session is no
// longer opaque (mock `origin/mock/aim-ui-sample` session `.shead` = per-
// session model / unit / cwd + a ctx warning). It reads the
// `AgentSnapshot` the SSE cache already holds (threaded from `useAgents` in
// `TerminalPanel`); no new fetch, no new endpoint.
//
// The ctx% warning colour is a STATIC convention here, not the Producer's
// `auto_handoff_threshold_pct`: workers have no auto-handoff ritual, so
// there is no per-project threshold to fetch — the bar just warns (amber)
// as context fills and turns red near full. The ctx readout reuses
// the shared `formatThousands` / `renderBar` ctx-format helpers so the two
// surfaces render identically.

import type { AgentSnapshot } from "@/lib/api";
import { formatThousands, renderBar } from "@/lib/ctx-format";
import { cn } from "@/lib/utils";

// Trim the canonical id (`<scheme>:<id>`) to `<scheme>:<first-8-chars>`
// for the header. `provisional:abcd1234` is more useful than the raw 8-char
// prefix of the whole string ("provisi…").
export function agentIdShort(agentId: string): string {
  const colon = agentId.indexOf(":");
  if (colon < 0) return agentId.slice(0, 8);
  return `${agentId.slice(0, colon)}:${agentId.slice(colon + 1, colon + 9)}`;
}

// Static ctx-fill warning bands (workers have no auto-handoff threshold):
// red near full, amber as it fills, muted otherwise.
function ctxWarningClass(pct: number): string {
  if (pct >= 90) return "text-destructive";
  if (pct >= 75) return "text-warning";
  return "text-muted-foreground";
}

interface TerminalSessionHeaderProps {
  /** Canonical agent id (`<scheme>:<id>`), always shown as the fallback
   *  identity even when the snapshot hasn't resolved yet. */
  agentId: string;
  /** The live snapshot for this session, resolved from `useAgents` by the
   *  parent. `undefined` (not yet in the cache / isolation tests) degrades
   *  gracefully to the id-only header this panel showed before C3. */
  agent: AgentSnapshot | undefined;
}

export function TerminalSessionHeader({ agentId, agent }: TerminalSessionHeaderProps) {
  const model = agent?.model_display_name ?? agent?.model_id ?? null;
  const cwd = agent?.display_cwd ?? agent?.cwd ?? null;
  const ctx = agent?.ctx_usage ?? null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-hairline-strong px-3 py-1.5 text-xs">
      <span className="shrink-0 font-mono text-muted-foreground">{agentIdShort(agentId)}</span>
      {model && (
        <span className="shrink-0 font-mono text-foreground" title={`model: ${model}`}>
          {model}
        </span>
      )}
      {cwd && (
        <span className="min-w-0 truncate font-mono text-subtle-foreground" title={cwd}>
          {cwd}
        </span>
      )}
      {ctx && (
        <span
          className={cn(
            "ml-auto flex shrink-0 items-center gap-1.5 font-mono",
            ctxWarningClass(ctx.pct),
          )}
          title={`ctx: ${formatThousands(ctx.used)} / ${formatThousands(ctx.total)} (${ctx.pct}%)`}
        >
          <span>{ctx.pct}%</span>
          <span className="text-muted-foreground" aria-hidden="true">
            {renderBar(ctx.pct).chars}
          </span>
        </span>
      )}
    </div>
  );
}
