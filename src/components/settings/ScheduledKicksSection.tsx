import { useCallback, useEffect, useState } from "react";
import {
  api,
  type GatingPredicate,
  type ScheduledKick,
  type ScheduledKickCreate,
  type ScheduledKickUpdate,
  type ScheduleSpec,
} from "@/lib/api";

// ── helpers ──

/** Validate a 5-field cron expression. Returns true for valid expressions. */
export function isValidCron(expr: string): boolean {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  // Each field: * | */n | n | n-m | n,m,... (basic check, no range limit validation)
  const fieldRe = /^(\*|\*\/\d+|\d+(-\d+)?(,\d+(-\d+)?)*)$/;
  return fields.every((f) => fieldRe.test(f));
}

/** Format a schedule spec to a short human-readable string. */
export function formatSchedule(spec: ScheduleSpec): string {
  if (spec.type === "interval") {
    const s = spec.seconds;
    if (s % 3600 === 0) return `every ${s / 3600}h`;
    if (s % 60 === 0) return `every ${s / 60}m`;
    return `every ${s}s`;
  }
  return spec.expression;
}

/** Format an RFC3339 timestamp as a relative string like "2h ago" or "in 5m". */
export function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const abs = Math.abs(diffMs);
  const future = diffMs < 0;
  let label: string;
  if (abs < 60_000) label = "just now";
  else if (abs < 3_600_000) label = `${Math.round(abs / 60_000)}m`;
  else if (abs < 86_400_000) label = `${Math.round(abs / 3_600_000)}h`;
  else label = `${Math.round(abs / 86_400_000)}d`;
  if (label === "just now") return label;
  return future ? `in ${label}` : `${label} ago`;
}

const GATING_OPTIONS: { value: GatingPredicate; label: string; description: string }[] = [
  { value: "any_time", label: "Any time", description: "No gating — always fires on schedule" },
  {
    value: "no_active_agents",
    label: "No active agents",
    description: "Skip if any agent is processing",
  },
  {
    value: "orchestrator_idle",
    label: "Orchestrator idle",
    description: "Skip if the orchestrator is active",
  },
];

// ── Form state ──

interface KickFormState {
  id: string;
  scheduleType: "interval" | "cron";
  intervalSecs: number;
  cronExpr: string;
  prompt: string;
  gatingPredicate: GatingPredicate;
  enabled: boolean;
}

function defaultForm(): KickFormState {
  return {
    id: "",
    scheduleType: "interval",
    intervalSecs: 3600,
    cronExpr: "",
    prompt: "",
    gatingPredicate: "any_time",
    enabled: true,
  };
}

function kickToForm(kick: ScheduledKick): KickFormState {
  return {
    id: kick.id,
    scheduleType: kick.schedule.type,
    intervalSecs: kick.schedule.type === "interval" ? kick.schedule.seconds : 3600,
    cronExpr: kick.schedule.type === "cron" ? kick.schedule.expression : "",
    prompt: kick.prompt,
    gatingPredicate: kick.gating_predicate,
    enabled: kick.enabled,
  };
}

function formToCreate(f: KickFormState): ScheduledKickCreate {
  const schedule: ScheduleSpec =
    f.scheduleType === "interval"
      ? { type: "interval", seconds: f.intervalSecs }
      : { type: "cron", expression: f.cronExpr };
  return {
    id: f.id,
    schedule,
    prompt: f.prompt,
    gating_predicate: f.gatingPredicate,
    enabled: f.enabled,
  };
}

function formToUpdate(f: KickFormState): ScheduledKickUpdate {
  const schedule: ScheduleSpec =
    f.scheduleType === "interval"
      ? { type: "interval", seconds: f.intervalSecs }
      : { type: "cron", expression: f.cronExpr };
  return {
    schedule,
    prompt: f.prompt,
    gating_predicate: f.gatingPredicate,
    enabled: f.enabled,
  };
}

// ── Sub-components ──

/** Single toggle switch styled like the rest of SettingsPanel. */
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
        checked ? "bg-cyan-500/40" : "bg-white/10"
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 rounded-full transition-transform ${
          checked ? "translate-x-[18px] bg-cyan-400" : "translate-x-0.5 bg-zinc-500"
        }`}
      />
    </button>
  );
}

/** Inline editor for creating or updating a kick. */
function KickForm({
  initial,
  isNew,
  onSave,
  onCancel,
}: {
  initial: KickFormState;
  isNew: boolean;
  onSave: (f: KickFormState) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<KickFormState>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const cronValid = form.scheduleType !== "cron" || isValidCron(form.cronExpr);

  const handleSave = async () => {
    if (!form.id.trim()) {
      setError("ID is required");
      return;
    }
    if (form.scheduleType === "cron" && !isValidCron(form.cronExpr)) {
      setError("Invalid cron expression (5 fields: min hour dom month dow)");
      return;
    }
    if (!form.prompt.trim()) {
      setError("Prompt is required");
      return;
    }
    setError("");
    setSaving(true);
    try {
      await onSave(form);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-cyan-500/20 bg-white/[0.03] p-3 space-y-3">
      {/* ID */}
      <div className="flex items-center gap-2">
        <span className="shrink-0 w-20 text-xs text-zinc-500">ID</span>
        <input
          type="text"
          value={form.id}
          onChange={(e) => setForm({ ...form, id: e.target.value })}
          disabled={!isNew}
          placeholder="morning-standup"
          className={`flex-1 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-cyan-500/30 font-mono ${
            !isNew ? "cursor-not-allowed opacity-50" : ""
          }`}
        />
      </div>

      {/* Schedule type */}
      <div className="flex items-start gap-2">
        <span className="shrink-0 w-20 text-xs text-zinc-500 mt-1">Schedule</span>
        <div className="flex-1 space-y-2">
          <div className="flex gap-2">
            {(["interval", "cron"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setForm({ ...form, scheduleType: t })}
                className={`rounded-md px-2.5 py-0.5 text-xs transition-colors ${
                  form.scheduleType === t
                    ? "bg-cyan-500/20 text-cyan-300"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {t === "interval" ? "Interval" : "Cron"}
              </button>
            ))}
          </div>

          {form.scheduleType === "interval" ? (
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={60}
                value={form.intervalSecs}
                onChange={(e) => {
                  const v = Number.parseInt(e.target.value, 10);
                  if (!Number.isNaN(v) && v >= 60) setForm({ ...form, intervalSecs: v });
                }}
                className="w-24 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-200 outline-none focus:border-cyan-500/30"
              />
              <span className="text-xs text-zinc-500">seconds</span>
            </div>
          ) : (
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={form.cronExpr}
                  onChange={(e) => setForm({ ...form, cronExpr: e.target.value })}
                  placeholder="0 9 * * 1-5"
                  className={`flex-1 rounded-md border px-2.5 py-1 text-xs text-zinc-200 placeholder-zinc-600 bg-white/5 outline-none font-mono ${
                    form.cronExpr
                      ? cronValid
                        ? "border-emerald-500/40 focus:border-emerald-500/60"
                        : "border-red-500/40 focus:border-red-500/60"
                      : "border-white/10 focus:border-cyan-500/30"
                  }`}
                />
                {form.cronExpr && (
                  <span
                    className={`text-[10px] ${cronValid ? "text-emerald-500" : "text-red-400"}`}
                  >
                    {cronValid ? "✓" : "✗"}
                  </span>
                )}
              </div>
              <p className="text-[10px] text-zinc-600">
                5 fields: minute hour day-of-month month day-of-week
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Prompt */}
      <div className="flex items-start gap-2">
        <span className="shrink-0 w-20 text-xs text-zinc-500 mt-1">Prompt</span>
        <textarea
          value={form.prompt}
          onChange={(e) => setForm({ ...form, prompt: e.target.value })}
          rows={4}
          placeholder="Describe the task the orchestrator should perform..."
          className="flex-1 rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-cyan-500/30 resize-y"
        />
      </div>

      {/* Gating predicate */}
      <div className="flex items-center gap-2">
        <span className="shrink-0 w-20 text-xs text-zinc-500">Gating</span>
        <select
          value={form.gatingPredicate}
          onChange={(e) => setForm({ ...form, gatingPredicate: e.target.value as GatingPredicate })}
          className="flex-1 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-200 outline-none focus:border-cyan-500/30"
        >
          {GATING_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value} title={opt.description}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
      <p className="text-[10px] text-zinc-600 -mt-1 ml-[88px]">
        {GATING_OPTIONS.find((o) => o.value === form.gatingPredicate)?.description}
      </p>

      {/* Enabled */}
      <div className="flex items-center justify-between gap-3">
        <span className="ml-[88px] text-xs text-zinc-400">Enabled</span>
        <Toggle checked={form.enabled} onChange={(v) => setForm({ ...form, enabled: v })} />
      </div>

      {/* Error */}
      {error && <p className="text-[11px] text-red-400">{error}</p>}

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-3 py-1 text-xs text-zinc-500 transition-colors hover:bg-white/10 hover:text-zinc-300"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-md bg-cyan-500/20 px-3 py-1 text-xs text-cyan-400 transition-colors hover:bg-cyan-500/30 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

/** Single kick row showing summary + action buttons. */
function KickRow({
  kick,
  onEdit,
  onDelete,
  onToggleEnabled,
  onDryRun,
}: {
  kick: ScheduledKick;
  onEdit: () => void;
  onDelete: () => void;
  onToggleEnabled: (enabled: boolean) => void;
  onDryRun: () => void;
}) {
  return (
    <div className="group rounded-lg border border-white/5 bg-white/[0.02] p-3 space-y-1.5 hover:border-white/10 transition-colors">
      {/* Header row */}
      <div className="flex items-center gap-2">
        <Toggle checked={kick.enabled} onChange={onToggleEnabled} />
        <code className="flex-1 text-xs text-zinc-200 font-mono truncate">{kick.id}</code>
        <div className="flex gap-1 shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={onDryRun}
            title="Preview rendered prompt without firing"
            className="rounded px-2 py-0.5 text-[10px] text-zinc-500 hover:bg-white/10 hover:text-zinc-300 transition-colors"
          >
            Dry Run
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="rounded px-2 py-0.5 text-[10px] text-zinc-500 hover:bg-white/10 hover:text-zinc-300 transition-colors"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="rounded px-2 py-0.5 text-[10px] text-zinc-600 hover:bg-red-500/10 hover:text-red-400 transition-colors"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Schedule */}
      <p className="text-[11px] text-zinc-500 ml-11 font-mono">{formatSchedule(kick.schedule)}</p>

      {/* Timestamps */}
      <div className="flex gap-3 ml-11">
        <span className="text-[10px] text-zinc-600">
          Last:{" "}
          <span className="text-zinc-500">
            {kick.last_fire ? formatRelative(kick.last_fire) : "—"}
          </span>
        </span>
        <span className="text-[10px] text-zinc-600">
          Next:{" "}
          <span className={kick.enabled && kick.next_fire ? "text-cyan-500/70" : "text-zinc-500"}>
            {kick.enabled && kick.next_fire ? formatRelative(kick.next_fire) : "—"}
          </span>
        </span>
      </div>

      {/* Prompt preview (truncated) */}
      <p className="text-[10px] text-zinc-600 ml-11 truncate">{kick.prompt}</p>
    </div>
  );
}

// ── Main component ──

export function ScheduledKicksSection() {
  const [kicks, setKicks] = useState<ScheduledKick[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null); // kick id, or "~new"
  const [dryRunResult, setDryRunResult] = useState<{
    kickId: string;
    renderedPrompt: string;
    nextFire: string | null;
  } | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setFetchError("");
    api
      .listScheduledKicks()
      .then((ks) => {
        setKicks(ks);
        setLoading(false);
      })
      .catch((e) => {
        setFetchError(e instanceof Error ? e.message : "Failed to load routines");
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleCreate = async (form: KickFormState) => {
    await api.createScheduledKick(formToCreate(form));
    setEditingId(null);
    refresh();
  };

  const handleUpdate = async (id: string, form: KickFormState) => {
    await api.updateScheduledKick(id, formToUpdate(form));
    setEditingId(null);
    refresh();
  };

  const handleDelete = async (id: string) => {
    setDeleteError("");
    try {
      await api.deleteScheduledKick(id);
      setDeleteConfirmId(null);
      refresh();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const handleToggleEnabled = async (kick: ScheduledKick, enabled: boolean) => {
    const updated: ScheduledKickUpdate = { enabled };
    setKicks((prev) => prev.map((k) => (k.id === kick.id ? { ...k, enabled } : k)));
    try {
      await api.updateScheduledKick(kick.id, updated);
    } catch {
      setKicks((prev) => prev.map((k) => (k.id === kick.id ? { ...k, enabled: !enabled } : k)));
    }
  };

  const handleDryRun = async (kick: ScheduledKick) => {
    try {
      const result = await api.dryRunKick(kick.id);
      setDryRunResult({
        kickId: kick.id,
        renderedPrompt: result.rendered_prompt,
        nextFire: result.next_fire,
      });
    } catch (e) {
      setDryRunResult({
        kickId: kick.id,
        renderedPrompt: `Error: ${e instanceof Error ? e.message : "dry-run failed"}`,
        nextFire: null,
      });
    }
  };

  return (
    <section>
      <h3 className="text-sm font-medium text-zinc-300">Routines</h3>
      <p className="mt-1 text-xs text-zinc-600">
        Schedule autonomous orchestrator kicks — write once, run on a cron or interval. Analogous to
        Claude Code Desktop Routines, but vendor-agnostic (CC / Codex / Gemini) with no quota beyond
        the vendor's own.
      </p>

      <div className="mt-3 space-y-2">
        {/* New kick form */}
        {editingId === "~new" && (
          <KickForm
            initial={defaultForm()}
            isNew
            onSave={handleCreate}
            onCancel={() => setEditingId(null)}
          />
        )}

        {/* Fetch error */}
        {fetchError && (
          <p className="rounded-md border border-red-500/20 bg-red-500/5 px-3 py-2 text-[11px] text-red-400">
            {fetchError}
          </p>
        )}

        {/* Kick list */}
        {loading ? (
          <p className="py-4 text-center text-xs text-zinc-600">Loading…</p>
        ) : kicks.length === 0 && editingId !== "~new" ? (
          <p className="py-4 text-center text-xs text-zinc-600">
            No routines configured. Click below to add one.
          </p>
        ) : (
          kicks.map((kick) =>
            editingId === kick.id ? (
              <KickForm
                key={kick.id}
                initial={kickToForm(kick)}
                isNew={false}
                onSave={(form) => handleUpdate(kick.id, form)}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <div key={kick.id}>
                {/* Delete confirmation inline */}
                {deleteConfirmId === kick.id ? (
                  <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 space-y-2">
                    <p className="text-xs text-red-300">
                      Delete routine <code className="font-mono">{kick.id}</code>? This cannot be
                      undone.
                    </p>
                    {deleteError && <p className="text-[11px] text-red-400">{deleteError}</p>}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleDelete(kick.id)}
                        className="rounded-md bg-red-500/20 px-3 py-1 text-xs text-red-400 transition-colors hover:bg-red-500/30"
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDeleteConfirmId(null);
                          setDeleteError("");
                        }}
                        className="rounded-md px-3 py-1 text-xs text-zinc-500 transition-colors hover:bg-white/10 hover:text-zinc-300"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <KickRow
                    kick={kick}
                    onEdit={() => setEditingId(kick.id)}
                    onDelete={() => setDeleteConfirmId(kick.id)}
                    onToggleEnabled={(enabled) => handleToggleEnabled(kick, enabled)}
                    onDryRun={() => handleDryRun(kick)}
                  />
                )}
              </div>
            ),
          )
        )}

        {/* Add button — hidden while editing */}
        {editingId === null && (
          <button
            type="button"
            onClick={() => setEditingId("~new")}
            className="w-full rounded-lg border border-dashed border-white/10 py-2 text-xs text-zinc-600 transition-colors hover:border-cyan-500/30 hover:text-cyan-400"
          >
            + New Routine
          </button>
        )}
      </div>

      {/* Dry-run result panel */}
      {dryRunResult && (
        <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.02] p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-300">
              Dry Run —{" "}
              <code className="font-mono text-[11px] text-zinc-400">{dryRunResult.kickId}</code>
            </span>
            <button
              type="button"
              onClick={() => setDryRunResult(null)}
              className="text-xs text-zinc-600 hover:text-zinc-300 transition-colors"
            >
              ✕
            </button>
          </div>
          {dryRunResult.nextFire && (
            <p className="text-[10px] text-zinc-500">
              Next fire: {formatRelative(dryRunResult.nextFire)}
            </p>
          )}
          <pre className="whitespace-pre-wrap rounded-md bg-black/20 px-3 py-2 text-[11px] text-zinc-300 font-mono overflow-auto max-h-48">
            {dryRunResult.renderedPrompt}
          </pre>
        </div>
      )}
    </section>
  );
}
