// ⬡ Settled decisions — third hand-over section (Phase A placeholder).
//
// The hand-over composer on the Producer side renders decisions
// bucketed by temperature: 📌 Foundational / 🔴 In-play / 🟡 Warm /
// ⚪ Cold. The wire endpoint (`GET /api/units/{unit}/decisions`) is
// not yet wired, so this section displays a user-readable "not yet
// automated" notice pointing at the repo's `doc/decisions/` for the
// time being. Earlier drafts of this string leaked phase-tracking
// jargon ("Phase C: `GET /api/units/...` is not yet wired") into the
// user UI, which read as broken; this revision drops that and
// addresses the operator directly.
//
// TODO(tmai-core#340): when multi-repo unit support lands, this
// section will need to show decisions from every repo in
// `UnitConfig.also[]`, not just the primary cwd. Per the
// simulated-onboarded posture DR (`doc/decisions/2026-05-14-webui-
// simulated-onboarded-posture.md`), the current copy is intentionally
// honest about the single-repo limitation.
// TODO(tmai-core#341): when `compose()` cold-start hardening lands,
// surface the `meta.missing_preconditions` signal here so an operator
// who hasn't run `tmai onboard <unit>` sees an actionable hint.

import type { SettledDecisionsPlaceholder } from "@/hooks/useHandover";

interface SettledDecisionsSectionProps {
  data: SettledDecisionsPlaceholder;
}

export function SettledDecisionsSection({ data: _data }: SettledDecisionsSectionProps) {
  return (
    <section>
      <header className="mb-2 flex items-baseline gap-2">
        <span className="text-base text-cyan-400">⬡</span>
        <h3 className="text-sm font-semibold text-zinc-200">Settled decisions</h3>
        <span className="rounded bg-zinc-700/50 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-zinc-400">
          not automated yet
        </span>
      </header>

      <div className="pl-6 text-xs text-zinc-500">
        <p>
          Browse your repo's <code className="text-zinc-300">doc/decisions/</code> directly to see
          settled decisions for now — the Producer reads them on session-start.
        </p>
        <p className="mt-2 text-zinc-600">
          When wired, this section will surface them bucketed by temperature: 📌 foundational · 🔴
          in-play · 🟡 warm · ⚪ cold — pulled from every repo this unit spans, not just the one you
          launched against.
        </p>
      </div>
    </section>
  );
}
