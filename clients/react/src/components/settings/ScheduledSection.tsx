import { useEffect, useState } from "react";
import { useSaveTracker } from "@/hooks/useSaveTracker";
import {
  api,
  type PermissionMode,
  type ScheduledSpawn,
  type ScheduledValidationError,
  type SpawnRole,
  type Vendor,
} from "@/lib/api";
import { SaveStatus } from "./SaveStatus";

// ── Constants ──────────────────────────────────────────────────────

const ROLE_OPTIONS: { value: SpawnRole; label: string; description: string }[] = [
  {
    value: "orchestrator",
    label: "Orchestrator",
    description: "Project orchestrator — composes prompt + bypasses capacity gate",
  },
  {
    value: "implementer",
    label: "Implementer",
    description: "One-shot worker using `[orchestration.dispatch.implementer]` bundle",
  },
  {
    value: "reviewer",
    label: "Reviewer",
    description: "One-shot worker using `[orchestration.dispatch.reviewer]` bundle",
  },
  {
    value: "manual",
    label: "Manual",
    description: "Bundle-less spawn — requires `vendor`, ignores [orchestration.*]",
  },
];

const VENDOR_OPTIONS: { value: Vendor; label: string }[] = [
  { value: "claude", label: "Claude" },
  { value: "codex", label: "Codex" },
  { value: "gemini", label: "Gemini" },
];

const PERMISSION_MODE_OPTIONS: { value: PermissionMode; label: string }[] = [
  { value: "default", label: "Default (interactive)" },
  { value: "plan", label: "Plan" },
  { value: "acceptEdits", label: "Accept edits" },
  { value: "dontAsk", label: "Don't ask" },
  { value: "auto", label: "Auto (opus only)" },
];

// ── Helpers ────────────────────────────────────────────────────────

/**
 * Lightweight client-side cron validator. Accepts the 5- / 6- / 7-field
 * forms the server's `normalize_cron_expr` accepts. Used only as a
 * fast-feedback hint — the server is authoritative and will return its
 * own structured error on save.
 */
export function looksLikeValidCron(expr: string): boolean {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5 && fields.length !== 6 && fields.length !== 7) return false;
  // Accept *, */n, n, n-m, n,m,..., or letter day-of-week (mon, tue, etc.).
  // The server uses the `cron` crate which also accepts richer forms; we
  // err toward permissive here so legitimate expressions don't get false
  // negatives in the UI.
  const fieldRe =
    /^(\*|\?|\*\/\d+|\d+(-\d+)?(\/\d+)?(,\d+(-\d+)?(\/\d+)?)*|[A-Za-z]{3,}(-[A-Za-z]{3,})?(,[A-Za-z]{3,}(-[A-Za-z]{3,})?)*)$/;
  return fields.every((f) => fieldRe.test(f));
}

function emptyEntry(): ScheduledSpawn {
  return {
    name: "",
    cron: "0 * * * *",
    cwd: "",
    prompt: "",
    role: "implementer",
    vendor: null,
    model: null,
    effort: null,
    permission_mode: null,
  };
}

/**
 * Extract a user-facing message from an `apiFetch` error. When the body is
 * the structured 400 payload from `PUT /api/settings/scheduled`, return a
 * `name: reason; …` summary; otherwise fall back to the raw message.
 */
function extractValidationMessage(e: unknown): string {
  if (!(e instanceof Error)) return "Save failed";
  const idx = e.message.indexOf("{");
  if (idx < 0) return e.message;
  let parsed: unknown;
  try {
    parsed = JSON.parse(e.message.slice(idx));
  } catch {
    return e.message;
  }
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "errors" in parsed &&
    Array.isArray((parsed as { errors: unknown }).errors)
  ) {
    const errs = (parsed as { errors: ScheduledValidationError[] }).errors;
    const summary = errs.map((er) => `${er.name}: ${er.reason}`).join("; ");
    return summary !== "" ? summary : e.message;
  }
  return e.message;
}

function entriesEqual(a: ScheduledSpawn, b: ScheduledSpawn): boolean {
  return (
    a.name === b.name &&
    a.cron === b.cron &&
    a.cwd === b.cwd &&
    a.prompt === b.prompt &&
    a.role === b.role &&
    (a.vendor ?? null) === (b.vendor ?? null) &&
    (a.model ?? null) === (b.model ?? null) &&
    (a.effort ?? null) === (b.effort ?? null) &&
    (a.permission_mode ?? null) === (b.permission_mode ?? null)
  );
}

// ── Subcomponents ──────────────────────────────────────────────────

interface EntryFormProps {
  initial: ScheduledSpawn;
  isNew: boolean;
  existingNames: string[];
  saving: boolean;
  serverError: string | null;
  onSave: (entry: ScheduledSpawn) => Promise<void>;
  onCancel: () => void;
}

function EntryForm({
  initial,
  isNew,
  existingNames,
  saving,
  serverError,
  onSave,
  onCancel,
}: EntryFormProps) {
  const [draft, setDraft] = useState<ScheduledSpawn>(initial);
  const [localError, setLocalError] = useState<string | null>(null);

  const cronOk = looksLikeValidCron(draft.cron);
  const isManual = draft.role === "manual";

  const handleSave = async () => {
    setLocalError(null);
    if (draft.name.trim() === "") return setLocalError("`name` is required");
    if (isNew && existingNames.includes(draft.name.trim())) {
      return setLocalError(`an entry named \`${draft.name.trim()}\` already exists`);
    }
    if (draft.cron.trim() === "") return setLocalError("`cron` is required");
    if (!cronOk) return setLocalError("`cron` does not look like a valid expression");
    if (draft.cwd.trim() === "") return setLocalError("`cwd` is required");
    if (!draft.cwd.startsWith("/")) return setLocalError("`cwd` must be an absolute path");
    if (draft.prompt.trim() === "") return setLocalError("`prompt` is required");
    if (isManual && !draft.vendor) {
      return setLocalError("`vendor` is required when role is `manual`");
    }

    // Strip empty-string overrides to null so the server sees them as absent.
    const normalized: ScheduledSpawn = {
      ...draft,
      name: draft.name.trim(),
      cron: draft.cron.trim(),
      cwd: draft.cwd.trim(),
      prompt: draft.prompt.trim(),
      vendor: draft.vendor ?? null,
      model: draft.model && draft.model.trim() !== "" ? draft.model.trim() : null,
      effort: draft.effort && draft.effort.trim() !== "" ? draft.effort.trim() : null,
      permission_mode: isManual ? (draft.permission_mode ?? null) : null,
    };
    await onSave(normalized);
  };

  return (
    <div className="rounded-lg border border-cyan-500/20 bg-white/[0.03] p-3 space-y-3">
      <Field label="Name">
        <input
          type="text"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          disabled={!isNew}
          placeholder="hourly-pr-check"
          className={`flex-1 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-cyan-500/30 font-mono ${
            !isNew ? "cursor-not-allowed opacity-50" : ""
          }`}
        />
      </Field>

      <Field label="Cron" help="5- / 6- / 7-field cron expression. Server validates.">
        <div className="flex-1 flex items-center gap-2">
          <input
            type="text"
            value={draft.cron}
            onChange={(e) => setDraft({ ...draft, cron: e.target.value })}
            placeholder="0 * * * *"
            className={`flex-1 rounded-md border bg-white/5 px-2.5 py-1 text-xs text-zinc-200 placeholder-zinc-600 outline-none font-mono ${
              draft.cron === ""
                ? "border-white/10 focus:border-cyan-500/30"
                : cronOk
                  ? "border-emerald-500/40 focus:border-emerald-500/60"
                  : "border-red-500/40 focus:border-red-500/60"
            }`}
          />
          {draft.cron !== "" && (
            <span className={`text-[10px] ${cronOk ? "text-emerald-500" : "text-red-400"}`}>
              {cronOk ? "✓" : "✗"}
            </span>
          )}
        </div>
      </Field>

      <Field label="CWD" help="Absolute path. The agent runs here.">
        <input
          type="text"
          value={draft.cwd}
          onChange={(e) => setDraft({ ...draft, cwd: e.target.value })}
          placeholder="/home/me/works/tmai"
          className="flex-1 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-cyan-500/30 font-mono"
        />
      </Field>

      <Field label="Role">
        <div className="flex-1 space-y-1">
          <select
            value={draft.role}
            onChange={(e) => setDraft({ ...draft, role: e.target.value as SpawnRole })}
            className="w-full rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-200 outline-none focus:border-cyan-500/30"
          >
            {ROLE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <p className="text-[10px] text-zinc-600">
            {ROLE_OPTIONS.find((o) => o.value === draft.role)?.description}
          </p>
        </div>
      </Field>

      <Field label="Prompt">
        <textarea
          value={draft.prompt}
          onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
          rows={4}
          placeholder="Describe what the agent should do..."
          className="flex-1 rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-cyan-500/30 resize-y"
        />
      </Field>

      {/* Vendor: required for Manual, optional override for bundled roles. */}
      <Field label="Vendor" help={isManual ? "Required for manual role." : "Optional override."}>
        <select
          value={draft.vendor ?? ""}
          onChange={(e) =>
            setDraft({
              ...draft,
              vendor: e.target.value === "" ? null : (e.target.value as Vendor),
            })
          }
          className="flex-1 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-200 outline-none focus:border-cyan-500/30"
        >
          <option value="">{isManual ? "(required — pick one)" : "(inherit from bundle)"}</option>
          {VENDOR_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Model" help="Optional override; leave blank to inherit.">
        <input
          type="text"
          value={draft.model ?? ""}
          onChange={(e) =>
            setDraft({ ...draft, model: e.target.value === "" ? null : e.target.value })
          }
          placeholder="claude-opus-4-7"
          className="flex-1 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-cyan-500/30 font-mono"
        />
      </Field>

      <Field label="Effort" help="Claude only. Leave blank to inherit.">
        <input
          type="text"
          value={draft.effort ?? ""}
          onChange={(e) =>
            setDraft({ ...draft, effort: e.target.value === "" ? null : e.target.value })
          }
          placeholder="high"
          className="flex-1 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-cyan-500/30"
        />
      </Field>

      {/* Permission mode is only honored for Manual; the other roles inherit
          their pm from the bundle (and resolve_dispatch disallows per-call
          override by design). Hide it to avoid confusing the user. */}
      {isManual && (
        <Field label="Permission" help="Only applies to manual role.">
          <select
            value={draft.permission_mode ?? ""}
            onChange={(e) =>
              setDraft({
                ...draft,
                permission_mode: e.target.value === "" ? null : (e.target.value as PermissionMode),
              })
            }
            className="flex-1 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-200 outline-none focus:border-cyan-500/30"
          >
            <option value="">(use vendor default)</option>
            {PERMISSION_MODE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </Field>
      )}

      {(localError || serverError) && (
        <p className="text-[11px] text-red-400">{localError ?? serverError}</p>
      )}

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
          onClick={() => void handleSave()}
          disabled={saving}
          className="rounded-md bg-cyan-500/20 px-3 py-1 text-xs text-cyan-400 transition-colors hover:bg-cyan-500/30 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="shrink-0 w-20 text-xs text-zinc-500 mt-1">{label}</span>
      <div className="flex-1 space-y-1">
        {children}
        {help && <p className="text-[10px] text-zinc-600">{help}</p>}
      </div>
    </div>
  );
}

interface EntryRowProps {
  entry: ScheduledSpawn;
  onEdit: () => void;
  onDelete: () => void;
}

function EntryRow({ entry, onEdit, onDelete }: EntryRowProps) {
  return (
    <div className="group rounded-lg border border-white/5 bg-white/[0.02] p-3 space-y-1.5 hover:border-white/10 transition-colors">
      <div className="flex items-center gap-2">
        <RoleBadge role={entry.role} />
        <code className="flex-1 text-xs text-zinc-200 font-mono truncate">{entry.name}</code>
        <div className="flex gap-1 shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
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
      <p className="text-[11px] text-zinc-500 ml-1 font-mono">
        <span className="text-cyan-500/70">{entry.cron}</span>
        <span className="text-zinc-600"> @ </span>
        <span className="text-zinc-500">{entry.cwd}</span>
      </p>
      <p className="text-[10px] text-zinc-600 ml-1 truncate">{entry.prompt}</p>
    </div>
  );
}

function RoleBadge({ role }: { role: SpawnRole }) {
  const palette: Record<SpawnRole, string> = {
    orchestrator: "bg-purple-500/15 text-purple-300 border-purple-500/30",
    implementer: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
    reviewer: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    manual: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  };
  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-wide ${palette[role]}`}
    >
      {role}
    </span>
  );
}

// ── Main component ─────────────────────────────────────────────────

/**
 * `[[scheduled]]` settings UI (tmai-core #20). Wraps `GET/PUT
 * /api/settings/scheduled` with a list-of-entries editor: each row is a
 * cron-driven spawn, edited atomically. The full list is sent on every
 * save — the server replaces the entire `[[scheduled]]` block, so a
 * stale tab will not silently clobber concurrent edits because the
 * server runs strict per-entry validation and refuses bad input with
 * structured `400 { errors: [...] }`.
 */
export function ScheduledSection() {
  const [entries, setEntries] = useState<ScheduledSpawn[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | "new" | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);
  const save = useSaveTracker();

  useEffect(() => {
    api
      .getScheduledSettings()
      .then((r) => setEntries(r.entries))
      .catch((e: unknown) =>
        setLoadError(e instanceof Error ? e.message : "Failed to load scheduled entries"),
      );
  }, []);

  if (loadError) {
    return (
      <section>
        <h3 className="text-sm font-medium text-zinc-300">Scheduled</h3>
        <p className="mt-1 text-xs text-red-400">{loadError}</p>
      </section>
    );
  }
  if (!entries) return null;

  const persist = async (next: ScheduledSpawn[]): Promise<boolean> => {
    setServerError(null);
    let ok = false;
    await save.track(
      async () => {
        try {
          await api.updateScheduledSettings({ entries: next });
          setEntries(next);
          ok = true;
        } catch (e: unknown) {
          setServerError(extractValidationMessage(e));
          throw e;
        }
      },
      { onError: () => {} },
    );
    return ok;
  };

  const handleAdd = async (entry: ScheduledSpawn) => {
    const next = [...entries, entry];
    if (await persist(next)) setEditingIndex(null);
  };

  const handleEdit = async (idx: number, entry: ScheduledSpawn) => {
    if (entriesEqual(entries[idx], entry)) {
      setEditingIndex(null);
      return;
    }
    const next = entries.map((e, i) => (i === idx ? entry : e));
    if (await persist(next)) setEditingIndex(null);
  };

  const handleDelete = async (idx: number) => {
    const next = entries.filter((_, i) => i !== idx);
    if (await persist(next)) setPendingDelete(null);
  };

  return (
    <section>
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium text-zinc-300">Scheduled</h3>
        <SaveStatus status={save.status} error={save.error} variant="section" />
      </div>
      <p className="mt-1 text-xs text-zinc-600">
        Cron-driven dispatches. Each entry independently spawns an agent on its schedule —
        orchestrator / implementer / reviewer roles inherit their{" "}
        <code className="font-mono">[orchestration.dispatch.*]</code> bundle; manual entries are
        bundle-less and must specify a vendor.
      </p>

      <div className="mt-3 space-y-2">
        {editingIndex === "new" && (
          <EntryForm
            initial={emptyEntry()}
            isNew
            existingNames={entries.map((e) => e.name)}
            saving={save.status === "saving"}
            serverError={serverError}
            onSave={handleAdd}
            onCancel={() => {
              setEditingIndex(null);
              setServerError(null);
            }}
          />
        )}

        {entries.length === 0 && editingIndex !== "new" ? (
          <p className="py-4 text-center text-xs text-zinc-600">
            No scheduled entries. Click below to add one.
          </p>
        ) : (
          entries.map((entry, idx) => {
            if (editingIndex === idx) {
              return (
                <EntryForm
                  key={entry.name}
                  initial={entry}
                  isNew={false}
                  existingNames={entries.filter((_, i) => i !== idx).map((e) => e.name)}
                  saving={save.status === "saving"}
                  serverError={serverError}
                  onSave={(e) => handleEdit(idx, e)}
                  onCancel={() => {
                    setEditingIndex(null);
                    setServerError(null);
                  }}
                />
              );
            }
            if (pendingDelete === idx) {
              return (
                <div
                  key={entry.name}
                  className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 space-y-2"
                >
                  <p className="text-xs text-red-300">
                    Delete <code className="font-mono">{entry.name}</code>? This cannot be undone.
                  </p>
                  {serverError && <p className="text-[11px] text-red-400">{serverError}</p>}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void handleDelete(idx)}
                      disabled={save.status === "saving"}
                      className="rounded-md bg-red-500/20 px-3 py-1 text-xs text-red-400 transition-colors hover:bg-red-500/30 disabled:opacity-50"
                    >
                      Delete
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPendingDelete(null);
                        setServerError(null);
                      }}
                      className="rounded-md px-3 py-1 text-xs text-zinc-500 transition-colors hover:bg-white/10 hover:text-zinc-300"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              );
            }
            return (
              <EntryRow
                key={entry.name}
                entry={entry}
                onEdit={() => {
                  setEditingIndex(idx);
                  setServerError(null);
                }}
                onDelete={() => {
                  setPendingDelete(idx);
                  setServerError(null);
                }}
              />
            );
          })
        )}

        {editingIndex === null && pendingDelete === null && (
          <button
            type="button"
            onClick={() => setEditingIndex("new")}
            className="w-full rounded-lg border border-dashed border-white/10 py-2 text-xs text-zinc-600 transition-colors hover:border-cyan-500/30 hover:text-cyan-400"
          >
            + New scheduled entry
          </button>
        )}
      </div>
    </section>
  );
}
