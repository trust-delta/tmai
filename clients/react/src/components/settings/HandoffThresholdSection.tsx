// Auto-handoff threshold control.
//
// Operators routinely tune this (handoff-lifecycle DR §E says "primary,
// not Advanced"), so the control sits in the top Producer group rather
// than inside `OrchestrationSection` which is collapsed behind the
// Advanced expandable.
//
// Persists `auto_handoff_threshold_pct` on the (global) OrchestratorSettings
// object via the same PUT helper calibration / orchestration rules use.
// `0` is a sentinel that disables the auto-trigger entirely; the manual
// `Handoff & restart` button still works.

import { useEffect, useState } from "react";
import { useSaveTracker } from "@/hooks/useSaveTracker";
import { api, type OrchestratorSettings } from "@/lib/api";
import { SaveStatus } from "./SaveStatus";

const INPUT_CLS =
  "w-20 rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-cyan-500/30";

const MIN_PCT = 0;
const MAX_PCT = 100;

function validate(value: string): { ok: true; pct: number } | { ok: false; error: string } {
  const trimmed = value.trim();
  if (trimmed === "") return { ok: false, error: "Enter a value between 0 and 100" };
  const n = Number(trimmed);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    return { ok: false, error: "Must be a whole number" };
  }
  if (n < MIN_PCT || n > MAX_PCT) {
    return { ok: false, error: `Must be between ${MIN_PCT} and ${MAX_PCT}` };
  }
  return { ok: true, pct: n };
}

export function HandoffThresholdSection() {
  const [orchestrator, setOrchestrator] = useState<OrchestratorSettings | null>(null);
  const [draft, setDraft] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const save = useSaveTracker();

  useEffect(() => {
    api
      .getOrchestratorSettings()
      .then((s) => {
        setOrchestrator(s);
        setDraft(String(s.auto_handoff_threshold_pct));
      })
      .catch(() => {});
  }, []);

  if (!orchestrator) return null;

  const commit = (value: string) => {
    setLocalError(null);
    const result = validate(value);
    if (!result.ok) {
      setLocalError(result.error);
      return;
    }
    const next = result.pct;
    if (next === orchestrator.auto_handoff_threshold_pct) return;
    const prev = orchestrator;
    setOrchestrator({ ...orchestrator, auto_handoff_threshold_pct: next });
    setDraft(String(next));
    void save.track(() => api.updateOrchestratorSettings({ auto_handoff_threshold_pct: next }), {
      onError: () => {
        setOrchestrator(prev);
        setDraft(String(prev.auto_handoff_threshold_pct));
      },
    });
  };

  const currentPct = orchestrator.auto_handoff_threshold_pct;
  const disabled = currentPct === 0;
  const statusLabel = disabled ? "Disabled" : `Triggers at ${currentPct}%`;

  return (
    <section>
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium text-zinc-300">Auto-handoff threshold (%)</h3>
        <SaveStatus status={save.status} error={save.error} variant="section" />
      </div>
      <p className="mt-1 text-xs text-zinc-600">
        Producer ritual auto-fires when context usage crosses this percent. Set to 0 to disable;
        manual <code className="text-zinc-500">Handoff &amp; restart</code> still works.
      </p>

      <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.02] p-3 space-y-2">
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={MIN_PCT}
            max={MAX_PCT}
            step={1}
            value={draft}
            onChange={(e) => {
              setLocalError(null);
              save.clearError();
              setDraft(e.target.value);
            }}
            onBlur={() => commit(draft)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (e.currentTarget as HTMLInputElement).blur();
              }
            }}
            className={INPUT_CLS}
            aria-label="Auto-handoff threshold percent"
          />
          <span className={`text-xs ${disabled ? "text-zinc-500" : "text-zinc-400"}`}>
            {statusLabel}
          </span>
        </div>
        {localError && (
          <p role="alert" className="text-[11px] text-red-400">
            {localError}
          </p>
        )}
      </div>
    </section>
  );
}
