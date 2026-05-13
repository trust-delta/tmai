// ◐ Working with this human — fourth hand-over section (Phase A placeholder).
//
// The Producer's `compose()` baseline builder emits a "working-norms
// delta" — process rules that diverge from the baseline `CLAUDE.md`,
// computed at session-start. The read endpoint is not yet wired, so
// this section displays an explicit placeholder pointing at the
// baseline `CLAUDE.md` as the fallback.

import type { WorkingWithHumanPlaceholder } from "@/hooks/useHandover";

interface WorkingWithThisHumanSectionProps {
  data: WorkingWithHumanPlaceholder;
}

export function WorkingWithThisHumanSection({ data }: WorkingWithThisHumanSectionProps) {
  return (
    <section>
      <header className="mb-2 flex items-baseline gap-2">
        <span className="text-base text-cyan-400">◐</span>
        <h3 className="text-sm font-semibold text-zinc-200">Working with this human</h3>
        <span className="rounded bg-zinc-700/50 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-zinc-400">
          phase C
        </span>
      </header>

      <div className="pl-6">
        <p className="text-xs text-zinc-500">{data.reason}</p>
        <p className="mt-2 text-xs text-zinc-600">
          Once wired, this section will list deltas from the baseline norms (language preference,
          review rituals, branch conventions, etc.) computed by the Producer's hand-over composer.
        </p>
      </div>
    </section>
  );
}
