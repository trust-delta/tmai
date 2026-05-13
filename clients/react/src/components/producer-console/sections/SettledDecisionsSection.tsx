// ⬡ Settled decisions — third hand-over section (Phase A placeholder).
//
// The hand-over composer on the Producer side renders decisions
// bucketed by temperature: 📌 Foundational / 🔴 In-play / 🟡 Warm /
// ⚪ Cold. The wire endpoint (`GET /api/units/{unit}/decisions`) is
// not yet wired, so this section explicitly tells the operator that
// the placeholder is intentional, what's missing, and where to read
// the records in the meantime.

import type { SettledDecisionsPlaceholder } from "@/hooks/useHandover";

interface SettledDecisionsSectionProps {
  data: SettledDecisionsPlaceholder;
}

export function SettledDecisionsSection({ data }: SettledDecisionsSectionProps) {
  return (
    <section>
      <header className="mb-2 flex items-baseline gap-2">
        <span className="text-base text-cyan-400">⬡</span>
        <h3 className="text-sm font-semibold text-zinc-200">Settled decisions</h3>
        <span className="rounded bg-zinc-700/50 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-zinc-400">
          phase C
        </span>
      </header>

      <div className="pl-6">
        <p className="text-xs text-zinc-500">{data.reason}</p>
        <p className="mt-2 text-xs text-zinc-600">
          Once wired, this section will surface DRs bucketed by temperature: 📌 foundational · 🔴
          in-play · 🟡 warm · ⚪ cold.
        </p>
      </div>
    </section>
  );
}
