// ◐ Working with this human — fourth hand-over section (Phase A placeholder).
//
// The Producer's `compose()` baseline builder emits a "working-norms
// delta" — process rules that diverge from the baseline `CLAUDE.md`,
// computed at session-start. The read endpoint is not yet wired, so
// this section displays a user-readable pointer at the baseline
// `CLAUDE.md` for the time being. (Earlier drafts surfaced phase-
// tracking text into this UI which made the section read as broken;
// this revision speaks to the operator directly instead.)
//
// TODO(tmai-core#341): the cold-start hardening issue is the natural
// place to expose `compose()` output (including this baseline delta)
// over the wire. Per the simulated-onboarded posture DR
// (`doc/decisions/2026-05-14-webui-simulated-onboarded-posture.md`),
// the current "see CLAUDE.md for now" copy is honest about the gap
// rather than fabricating a synthetic delta.

import type { WorkingWithHumanPlaceholder } from "@/hooks/useHandover";

interface WorkingWithThisHumanSectionProps {
  data: WorkingWithHumanPlaceholder;
}

export function WorkingWithThisHumanSection({ data: _data }: WorkingWithThisHumanSectionProps) {
  return (
    <section>
      <header className="mb-2 flex items-baseline gap-2">
        <span className="text-base text-cyan-400">◐</span>
        <h3 className="text-sm font-semibold text-zinc-200">Working with this human</h3>
        <span className="rounded bg-zinc-700/50 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-zinc-400">
          not automated yet
        </span>
      </header>

      <div className="pl-6 text-xs text-zinc-500">
        <p>
          See your repo's <code className="text-zinc-300">CLAUDE.md</code> for the baseline norms
          (language, review rituals, branch conventions, …) — the Producer reads it on
          session-start.
        </p>
        <p className="mt-2 text-zinc-600">
          When wired, this section will surface deltas from the baseline computed by the Producer's
          hand-over composer.
        </p>
      </div>
    </section>
  );
}
