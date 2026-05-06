import { useShowAutoDiscovered } from "@/hooks/useShowAutoDiscovered";

/**
 * Settings section for tmai/CC dev affordances. Lives at the bottom of
 * the panel and is intentionally tiny — these are toggles for people
 * working on tmai itself, not regular operators.
 *
 * Preferences here are stored in `localStorage` (per-browser), not in
 * `tmai-core` settings, because they describe how *this* WebUI shows
 * the same backend data — not what the backend should do.
 */
export function DeveloperSection() {
  const { show, set } = useShowAutoDiscovered();

  return (
    <section>
      <h3 className="text-sm font-medium text-zinc-300">Developer</h3>
      <p className="mt-1 text-xs text-zinc-600">
        Toggles for tmai / Claude Code dev work. Preferences are local to this browser.
      </p>

      <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.02] p-3">
        <label className="flex items-center justify-between gap-3">
          <div className="flex-1">
            <span className="text-sm text-zinc-300">Show auto-discovered agents</span>
            <p className="text-[11px] text-zinc-600 mt-0.5">
              Surface Claude Code sessions tmai never spawned (e.g. an interactive{" "}
              <code className="rounded bg-white/5 px-1">claude</code> you started in tmux). They
              fire hooks at tmai-core's shared{" "}
              <code className="rounded bg-white/5 px-1">/hooks/event</code> URL and land in the
              registry as auto-discovered. Off by default.
            </p>
          </div>
          <button
            type="button"
            onClick={() => set(!show)}
            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
              show ? "bg-cyan-500/40" : "bg-white/10"
            }`}
            aria-label="Show auto-discovered agents"
            aria-pressed={show}
          >
            <span
              className={`inline-block h-3.5 w-3.5 rounded-full transition-transform ${
                show ? "translate-x-[18px] bg-cyan-400" : "translate-x-0.5 bg-zinc-500"
              }`}
            />
          </button>
        </label>
      </div>
    </section>
  );
}
