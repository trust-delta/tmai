import { useEffect, useState } from "react";
import type { DispatchBundle } from "@/types/generated/DispatchBundle";
import type { PermissionMode } from "@/types/generated/PermissionMode";
import type { Vendor } from "@/types/generated/Vendor";

const VENDORS: Vendor[] = ["claude", "codex", "gemini"];

const PERMISSION_MODES: { value: PermissionMode; label: string }[] = [
  { value: "plan", label: "plan" },
  { value: "acceptEdits", label: "accept_edits" },
  { value: "dontAsk", label: "dont_ask" },
  { value: "auto", label: "auto" },
  { value: "default", label: "default" },
];

const EFFORT_VALUES = ["low", "medium", "high", "xhigh", "max"] as const;

const MODEL_PLACEHOLDERS: Record<Vendor, string> = {
  claude: "claude-opus-4-7",
  codex: "codex-1",
  gemini: "gemini-2.5-pro",
};

// Mirrors `vendor_compat::permission_mode_allowed` in tmai-core so the UI
// disables combinations the backend would reject. Keep in sync with
// `crates/tmai-core/src/config/vendor_compat.rs` — the codex / gemini rows
// are placeholders and will tighten once vendor CLI docs are confirmed.
function isPermissionModeAllowed(vendor: Vendor, model: string, mode: PermissionMode): boolean {
  switch (vendor) {
    case "claude":
      if (mode === "auto") return model.startsWith("claude-opus-");
      return mode === "default" || mode === "plan" || mode === "dontAsk" || mode === "acceptEdits";
    case "codex":
      return mode === "default" || mode === "acceptEdits";
    case "gemini":
      return mode === "default";
    default: {
      // Exhaustiveness: a new Vendor variant must extend this matrix
      // explicitly rather than silently disabling every mode.
      const _exhaustive: never = vendor;
      return false;
    }
  }
}

function permissionModeReason(vendor: Vendor, mode: PermissionMode): string {
  if (vendor === "claude" && mode === "auto") return "requires opus-tier model";
  return `not supported by ${vendor}`;
}

interface DispatchBundleEditorProps {
  title: string;
  subtitle: string;
  bundle: DispatchBundle | null | undefined;
  /**
   * Atomic-field change (vendor / permission_mode / effort dropdowns and the
   * "Use vendor CLI default" checkbox). Caller persists immediately.
   */
  onAtomicChange: (bundle: DispatchBundle | null) => void;
  /**
   * Text-field draft (model input) — caller updates local state without saving.
   * Used while the user is mid-typing.
   */
  onTextDraft: (bundle: DispatchBundle | null) => void;
  /**
   * Text-field commit (model input on blur or Enter). Caller persists.
   */
  onTextCommit: (bundle: DispatchBundle | null) => void;
}

/**
 * Edits a single dispatch bundle (vendor/model/permission_mode/effort).
 * When bundle is null the "Use vendor CLI default" checkbox is checked,
 * all inputs are disabled, and the role launches with the vendor CLI's own
 * defaults (no `--model` / `--permission-mode` flags injected by tmai).
 *
 * Auto-save (#578): atomic fields persist on change; the model field
 * persists on blur or Enter. The local model draft tracks user typing so
 * we do not call onTextCommit on every keystroke.
 */
export function DispatchBundleEditor({
  title,
  subtitle,
  bundle,
  onAtomicChange,
  onTextDraft,
  onTextCommit,
}: DispatchBundleEditorProps) {
  const useLegacy = bundle == null;
  // Maintain a working copy for when the checkbox is unchecked.
  const active: DispatchBundle = bundle ?? { vendor: "claude" };

  // Local draft for the model text field — keeps typing fluid without
  // round-tripping to the backend on every keystroke.
  const [modelDraft, setModelDraft] = useState<string>(active.model ?? "");

  // Re-sync the draft when the upstream bundle changes (e.g., after a
  // commit, a vendor switch reset the model, or initial load).
  // Skipping the sync when the draft already matches avoids stomping on
  // an in-progress edit.
  useEffect(() => {
    const upstream = bundle?.model ?? "";
    setModelDraft(upstream);
    // We deliberately re-sync only when the upstream model identity changes —
    // not on every render — so user typing isn't reset between renders that
    // happen while a save is in flight.
  }, [bundle?.model]);

  const handleLegacyToggle = (checked: boolean) => {
    onAtomicChange(checked ? null : { vendor: "claude" });
  };

  const handleVendorChange = (vendor: Vendor) => {
    // Changing vendor resets model — no point keeping a cross-vendor model name.
    setModelDraft("");
    // Drop the persisted permission_mode if it's no longer valid for the new
    // vendor (e.g. `auto` after switching from claude to codex). Otherwise
    // the next save would 400 on the backend's matrix check.
    const next: DispatchBundle = { ...active, vendor, model: null };
    if (active.permission_mode && !isPermissionModeAllowed(vendor, "", active.permission_mode)) {
      next.permission_mode = null;
    }
    onAtomicChange(next);
  };

  const handleModelDraftChange = (model: string) => {
    setModelDraft(model);
    onTextDraft({ ...active, model: model || null });
  };

  const handleModelCommit = () => {
    const next: DispatchBundle = { ...active, model: modelDraft || null };
    // Drop `auto` if the new model isn't opus-tier — same matrix rule as
    // handleVendorChange but triggered by the model field.
    if (
      next.permission_mode &&
      !isPermissionModeAllowed(next.vendor, next.model ?? "", next.permission_mode)
    ) {
      next.permission_mode = null;
    }
    onTextCommit(next);
  };

  const handlePermissionChange = (value: string) => {
    const mode = value === "" ? null : (value as PermissionMode);
    onAtomicChange({ ...active, permission_mode: mode });
  };

  const handleEffortChange = (value: string) => {
    onAtomicChange({ ...active, effort: value || null });
  };

  const inputCls =
    "w-full rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-zinc-200 outline-none focus:border-cyan-500/30 disabled:opacity-40 disabled:cursor-not-allowed";

  return (
    <div className="rounded-md border border-white/10 bg-white/[0.02] p-3 space-y-3">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <span className="text-xs font-medium text-zinc-300">{title}</span>
          <span className="ml-1 text-xs text-zinc-600">({subtitle})</span>
        </div>
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={useLegacy}
            onChange={(e) => handleLegacyToggle(e.target.checked)}
            className="accent-cyan-500"
            aria-label={`Use vendor CLI default for ${title}`}
          />
          <span className="text-xs text-zinc-500">Use vendor CLI default</span>
        </label>
      </div>

      {/* Field grid — disabled when using legacy fallback */}
      <div
        className={`space-y-2 transition-opacity ${useLegacy ? "opacity-40 pointer-events-none" : ""}`}
        aria-disabled={useLegacy}
      >
        {/* Vendor */}
        <div className="flex items-center gap-3">
          <span className="w-24 shrink-0 text-xs text-zinc-500">Vendor</span>
          <select
            value={active.vendor}
            onChange={(e) => handleVendorChange(e.target.value as Vendor)}
            disabled={useLegacy}
            className={inputCls}
            aria-label={`Vendor for ${title}`}
          >
            {VENDORS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>

        {/* Model */}
        <div className="flex items-center gap-3">
          <span className="w-24 shrink-0 text-xs text-zinc-500">Model</span>
          <input
            type="text"
            value={modelDraft}
            placeholder={MODEL_PLACEHOLDERS[active.vendor]}
            onChange={(e) => handleModelDraftChange(e.target.value)}
            onBlur={handleModelCommit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleModelCommit();
              }
            }}
            disabled={useLegacy}
            className={inputCls}
            aria-label={`Model for ${title}`}
          />
        </div>

        {/* Permission mode */}
        <div className="flex items-center gap-3">
          <span className="w-24 shrink-0 text-xs text-zinc-500">Permission</span>
          <select
            value={active.permission_mode ?? ""}
            onChange={(e) => handlePermissionChange(e.target.value)}
            disabled={useLegacy}
            className={inputCls}
            aria-label={`Permission mode for ${title}`}
          >
            <option value="">— (default)</option>
            {PERMISSION_MODES.filter((o) => o.value !== "default").map((opt) => {
              const allowed = isPermissionModeAllowed(active.vendor, active.model ?? "", opt.value);
              return (
                <option key={opt.value} value={opt.value} disabled={!allowed}>
                  {opt.label}
                  {!allowed ? ` (${permissionModeReason(active.vendor, opt.value)})` : ""}
                </option>
              );
            })}
          </select>
        </div>

        {/* Effort (claude only) */}
        <div className="flex items-center gap-3">
          <span className="w-24 shrink-0 text-xs text-zinc-500">Effort</span>
          {active.vendor === "claude" ? (
            <select
              value={active.effort ?? ""}
              onChange={(e) => handleEffortChange(e.target.value)}
              disabled={useLegacy}
              className={inputCls}
              aria-label={`Effort for ${title}`}
            >
              <option value="">— (default)</option>
              {EFFORT_VALUES.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-xs text-zinc-600">(n/a — {active.vendor})</span>
          )}
        </div>
      </div>
    </div>
  );
}
