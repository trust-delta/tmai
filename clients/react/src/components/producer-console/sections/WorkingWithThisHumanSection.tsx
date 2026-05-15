// ◐ Working with this human — fourth hand-over section, wired to
// `GET /api/units/{unit}/working-with-human` (tmai-core PR #360).
//
// Surfaces the same `◐` section the Producer reads on session-start:
// the memory directory path + the raw `MEMORY.md` index. Per the
// workbench renderer (`tmai-core/crates/tmai-core/src/workbench/render.rs`)
// the on-disk per-entry memory files are *pointed at* but not inlined
// — the index is the load-bearing content. This section follows the
// same shape: header + rendered MEMORY.md inside a collapsible
// `<details>` so the digest stays scannable.
//
// `unit = null` → "pick a project first" placeholder, no fetch. Per
// the simulated-onboarded posture DR, an unresolved memory dir
// (`dir = null`) reads as "no memory dir configured" rather than
// fabricating a synthetic baseline.
//
// TODO(tmai-core multi-repo memory): the wire surfaces the *primary*
// repo's memory dir only — `hand_over_for_unit` currently composes
// just that one. When per-repo `memory_dir` lands as a sibling of the
// per-repo `decisions_dir` follow-up, this section will render one
// group per repo (mirroring `SettledDecisionsSection`).

import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useWorkingWithHuman } from "@/hooks/useWorkingWithHuman";

interface WorkingWithThisHumanSectionProps {
  unitName: string | null;
}

export function WorkingWithThisHumanSection({ unitName }: WorkingWithThisHumanSectionProps) {
  const { data, loading, error } = useWorkingWithHuman(unitName);

  return (
    <section>
      <header className="mb-2 flex items-baseline gap-2">
        <span className="text-base text-cyan-400">◐</span>
        <h3 className="text-sm font-semibold text-zinc-200">Working with this human</h3>
        {loading && data === null && <span className="text-[10px] text-zinc-500">loading…</span>}
      </header>
      <WorkingBody unitName={unitName} data={data} loading={loading} error={error} />
    </section>
  );
}

interface WorkingBodyProps {
  unitName: string | null;
  data: ReturnType<typeof useWorkingWithHuman>["data"];
  loading: boolean;
  error: Error | null;
}

function WorkingBody({ unitName, data, loading, error }: WorkingBodyProps) {
  if (unitName === null) {
    return (
      <div className="pl-6 text-xs text-zinc-500">
        <p>
          Pick a project (click a unit chip in{" "}
          <span className="text-zinc-400">⬢ Cross-unit status</span> above, or use the sidebar) to
          see this unit's memory index and working-with-human context.
        </p>
      </div>
    );
  }

  if (error !== null) {
    return (
      <div className="pl-6 text-xs text-red-300/80">
        <p>
          Failed to load working-with-human view:{" "}
          <code className="text-red-300">{error.message}</code>
        </p>
        <p className="mt-1 text-zinc-500">
          Baseline norms live in your repo's <code className="text-zinc-300">CLAUDE.md</code>
          {"; per-conversation memory under "}
          <code className="text-zinc-300">~/.claude/projects/</code>.
        </p>
      </div>
    );
  }

  if (data === null && loading) {
    return <div className="pl-6 text-xs text-zinc-500">Loading…</div>;
  }

  if (data === null) {
    return (
      <div className="pl-6 text-xs text-zinc-500">
        <p>No data resolved for this unit.</p>
      </div>
    );
  }

  if (data.dir === null) {
    return (
      <div className="pl-6 text-xs text-zinc-500">
        <p>
          No memory directory configured for <code className="text-zinc-300">{data.unit}</code>. The
          Producer will work from <code className="text-zinc-300">CLAUDE.md</code> + decision
          records only.
        </p>
        <p className="mt-1 text-zinc-600">
          To opt in: set <code className="text-zinc-300">[[unit]].memory_dir</code> in{" "}
          <code className="text-zinc-300">~/.config/tmai/config.toml</code>, or create{" "}
          <code className="text-zinc-300">~/.claude/projects/&lt;slug&gt;/memory/</code> for the
          unit's primary repo.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2 pl-6 text-xs">
      <p className="text-zinc-500">
        Process rules: per repo's <code className="text-zinc-300">CLAUDE.md</code>.
        Cross-conversation memory index lives at{" "}
        <code className="text-[10.5px] text-zinc-400">{data.dir}</code>.
      </p>
      {data.memory_index === null || data.memory_index.trim() === "" ? (
        <p className="text-zinc-600">
          (no <code className="text-zinc-300">MEMORY.md</code> found in this dir yet)
        </p>
      ) : (
        <details className="rounded border border-white/5 bg-white/[0.02]">
          <summary className="cursor-pointer select-none px-3 py-1.5 text-[11px] text-zinc-300 hover:text-zinc-100">
            Memory index ({lineCount(data.memory_index)} lines)
          </summary>
          <div className="prose prose-invert prose-sm max-w-none border-t border-white/5 px-3 py-2 text-zinc-300 [&_a]:text-cyan-300 [&_code]:rounded [&_code]:bg-white/[0.04] [&_code]:px-1 [&_code]:py-px [&_code]:text-zinc-300 [&_h1]:text-sm [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:text-xs [&_h3]:font-semibold [&_li]:my-0.5 [&_ol]:my-1 [&_p]:my-1 [&_pre]:rounded [&_pre]:bg-black/30 [&_pre]:p-2 [&_strong]:text-zinc-200 [&_ul]:my-1">
            <Markdown remarkPlugins={[remarkGfm]}>{data.memory_index}</Markdown>
          </div>
        </details>
      )}
    </div>
  );
}

function lineCount(s: string): number {
  return s.split("\n").length;
}
