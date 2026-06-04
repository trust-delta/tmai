// Per-artifact attention marker — the R-panel half of the attention model
// (contract
// `tmai-core:doc/approaches/2026-06-04-attention-as-per-artifact-field.md`,
// §3 core). Rendered on the LEFT of every attention-artifact row (PR / Issue
// / Decision / Approach). File rows are attention-exempt and never render one.
//
// Two responsibilities in one control:
//
//   1. DISPLAY the artifact's attention level with authorship-scoped color —
//      `null` is a machine fact (unconfirmed / changed) → a neutral pending
//      marker, no heat; `low`/`high` are the operator's own appraisal → heat
//      is allowed (muted `low`, bright `high`). Color follows authorship:
//      only human-set marks are colored. The rest of the R panel's facts stay
//      neutral, so a section reads as a focus map — the one bright `high`, the
//      muted `low`s, the pending `null`s (the Δ).
//
//   2. SET `low`/`high` (the operator write). The popover offers ONLY `low`
//      and `high` — the operator can never set `null` (the
//      `AttentionSetRequest.level` type has no `null` variant; `null` is
//      machine-only, by absence). The actual POST + monotonic / `high`≤1
//      enforcement lives server-side; this control just calls `onSet` and the
//      hook re-renders from the returned map.

import { useEffect, useId, useRef, useState } from "react";
import { type AttentionControls, attentionKey } from "@/hooks/useUnitAttention";
import type { Level, Section } from "@/lib/api";

interface AttentionMarkerProps {
  /** Current attention: `null` (machine fact, pending) or operator-set. */
  level: Level | null;
  /** Operator write. `low`/`high` only — `null` is not offerable. */
  onSet: (level: Level) => void;
  /** POST in flight for this artifact → disable the control. */
  busy?: boolean;
  /** Human-readable artifact label for the a11y name (e.g. `#123`, slug). */
  label: string;
}

// Glyph per pole. `null` is a hollow ring (pending / unset); `low`/`high` are
// filled — their distinction is carried by the heat class, not the glyph, so
// the row reads as brightness, not iconography.
const GLYPH: Record<"null" | Level, string> = {
  null: "○",
  low: "●",
  high: "●",
};

// Authorship-scoped color class. `null` stays neutral (machine fact); the
// `low`/`high` heat classes live in globals.css (deliberately not the CI
// severity utilities — see that block's comment).
const HEAT_CLASS: Record<"null" | Level, string> = {
  null: "text-subtle-foreground",
  low: "attn-low",
  high: "attn-high",
};

const POLE_LABEL: Record<"null" | Level, string> = {
  null: "pending",
  low: "low",
  high: "high",
};

const SET_OPTIONS: readonly Level[] = ["low", "high"];

export function AttentionMarker({ level, onSet, busy = false, label }: AttentionMarkerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const menuId = useId();
  const pole = level ?? "null";

  // Close on outside click or Escape (same affordance as QueuePopover).
  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const choose = (next: Level) => {
    setOpen(false);
    onSet(next);
  };

  return (
    <span ref={ref} className="relative inline-flex shrink-0 leading-none">
      <button
        type="button"
        data-testid="attention-marker"
        data-level={pole}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        // Stop the click from bubbling to the row button (which opens the R₂
        // viewer): the marker is its own control, sitting beside the row.
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        title={`Attention: ${POLE_LABEL[pole]} — set low/high`}
        aria-label={`Attention for ${label}: ${POLE_LABEL[pole]}. Set low or high.`}
        className={`flex h-4 w-4 items-center justify-center rounded text-[11px] transition-colors hover:bg-surface-strong/60 disabled:opacity-40 ${HEAT_CLASS[pole]}`}
      >
        <span aria-hidden="true">{GLYPH[pole]}</span>
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={`Set attention for ${label}`}
          className="absolute left-0 top-full z-50 mt-1 flex min-w-20 flex-col rounded-lg border border-hairline-strong bg-popover py-1 shadow-xl"
        >
          {SET_OPTIONS.map((opt) => (
            <button
              key={opt}
              type="button"
              role="menuitem"
              data-testid={`attention-set-${opt}`}
              aria-current={level === opt ? "true" : undefined}
              onClick={(e) => {
                e.stopPropagation();
                choose(opt);
              }}
              className={`px-3 py-1 text-left text-[11px] transition-colors hover:bg-surface-strong/60 ${HEAT_CLASS[opt]}`}
            >
              <span aria-hidden="true" className="mr-1.5">
                {GLYPH[opt]}
              </span>
              {POLE_LABEL[opt]}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

// Row binding — maps a (section,id) artifact onto its attention marker,
// deriving the busy state from the shared `settingKey`. Renders nothing when
// no attention controls are threaded (e.g. a section mounted in isolation),
// so the marker is opt-in: `RPanel` threads the controls, so the live panel
// always shows markers; standalone renders stay marker-free.
export function RowAttentionMarker({
  attention,
  section,
  id,
  label,
}: {
  attention?: AttentionControls;
  section: Section;
  id: string;
  label: string;
}) {
  if (!attention) return null;
  return (
    <AttentionMarker
      level={attention.levelFor(section, id)}
      onSet={(level) => attention.setAttention(section, id, level)}
      busy={attention.settingKey === attentionKey(section, id)}
      label={label}
    />
  );
}
