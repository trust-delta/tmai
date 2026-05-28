// Δ stream — R panel's mechanical change-fact ticker.
//
// approach `doc/approaches/2026-05-29-r-panel-as-project-artifact-
// inventory.md` §"Δ stream + Producer 確認 trigger".
//
// Source = `useProducerFeed(unit)` (the same producer-feed cursor
// the Producer pull reads — 1 cursor, 2 consumers). The hook
// currently only carries the mechanical delta-gate
// (`has_pending_delta = tip > last_served_cursor`), not enumerated
// items. TODO(tmai-core: producer-feed items wire) — we render the
// single gate-derived fact honestly; once an items wire lands the
// stream becomes a chronological bulleted list of individual facts.
//
// Negative space (the approach's "tmai は何を絶対しない" rules):
//   - no aggregation, no grouping, no severity color, no priority
//     sort, no badge/count;
//   - empty state → render NOTHING (the component returns null);
//   - `[→Producer ⚡]` trigger button to the right of the header is
//     the existing "Check deltas ▸" button relocated from
//     `ProducerConsoleActions`.

import type { ProducerFeedStatus } from "@/lib/api";

interface DeltaStreamProps {
  unitName: string | null;
  data: ProducerFeedStatus | null;
  /** Single arg-free trigger — App.tsx closes over the unit name.
   *  Pings the unit's live Producer to pull pending feed deltas and
   *  advances the cursor server-side. */
  onTriggerDeltaPull: () => void;
  /** Whether a live Producer exists for the unit. Gates the button
   *  enablement the same way `ProducerConsoleActions` used to. */
  producerAvailable: boolean;
}

export function DeltaStream({
  unitName,
  data,
  onTriggerDeltaPull,
  producerAvailable,
}: DeltaStreamProps) {
  // `has_pending_delta` is optional/absent on the wire when false
  // (#404 lockstep-free bool); treat anything other than explicit
  // true as no pending delta.
  const hasPendingDelta = data?.has_pending_delta === true;

  // Negative-space rule: empty state renders nothing. No
  // placeholder, no "no new items" line — the section is simply
  // absent when there is nothing to show.
  if (!hasPendingDelta) {
    return null;
  }

  // No real clock available on the wire yet; the gate is "as of
  // last poll". Use the current time as the fact timestamp until
  // the items wire carries per-fact timestamps. This stays honest
  // (`HH:MM` reflects when the operator sees it, which IS the
  // "as of now" fact for a gate-derived rendering).
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const pending = data === null ? 0n : data.tip - data.last_served_cursor;

  return (
    <div data-testid="delta-stream" className="border-b border-hairline px-4 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">Δ stream</h2>
        <button
          type="button"
          onClick={onTriggerDeltaPull}
          disabled={unitName === null || !producerAvailable}
          aria-label="Trigger producer pull"
          className="rounded bg-surface px-2 py-0.5 text-[11px] text-foreground transition-colors hover:bg-surface-strong disabled:opacity-50"
          title={
            unitName === null
              ? "No unit resolved yet"
              : !producerAvailable
                ? "No live Producer for this unit"
                : "Ping the Producer to pull pending feed deltas"
          }
        >
          →Producer ⚡
        </button>
      </div>
      <ul className="mt-1 space-y-0.5 text-xs text-foreground">
        <li>
          <span className="font-mono text-subtle-foreground">
            {hh}:{mm}
          </span>{" "}
          {String(pending)} pending delta{pending === 1n ? "" : "s"}{" "}
          <span className="text-subtle-foreground">
            (tip {String(data?.tip ?? 0n)}, served {String(data?.last_served_cursor ?? 0n)})
          </span>
        </li>
      </ul>
      <p className="mt-1 text-[10.5px] text-subtle-foreground">
        TODO(tmai-core: producer-feed items wire) — per-fact stream not yet exposed; gate-derived
        single line for now.
      </p>
    </div>
  );
}
