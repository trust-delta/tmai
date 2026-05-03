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
  claude: "claude-opus-4-6",
  codex: "codex-1",
  gemini: "gemini-2.5-pro",
};

/** auto is only valid for claude vendor with an opus-tier model. */
function isAutoDisabled(vendor: Vendor, model: string): boolean {
  if (vendor !== "claude") return true;
  return !model.startsWith("claude-opus-");
}

interface DispatchBundleEditorProps {
  title: string;
  subtitle: string;
  bundle: DispatchBundle | null | undefined;
  onChange: (bundle: DispatchBundle | null) => void;
}

/**
 * Edits a single dispatch bundle (vendor/model/permission_mode/effort).
 * When bundle is null the "Use vendor CLI default" checkbox is checked,
 * all inputs are disabled, and the role launches with the vendor CLI's own
 * defaults (no `--model` / `--permission-mode` flags injected by tmai).
 */
export function DispatchBundleEditor({
  title,
  subtitle,
  bundle,
  onChange,
}: DispatchBundleEditorProps) {
  const useLegacy = bundle == null;
  // Maintain a working copy for when the checkbox is unchecked.
  const active: DispatchBundle = bundle ?? { vendor: "claude" };

  const handleLegacyToggle = (checked: boolean) => {
    onChange(checked ? null : { vendor: "claude" });
  };

  const handleVendorChange = (vendor: Vendor) => {
    // Changing vendor resets model — no point keeping a cross-vendor model name.
    onChange({ ...active, vendor, model: null });
  };

  const handleModelChange = (model: string) => {
    onChange({ ...active, model: model || null });
  };

  const handlePermissionChange = (value: string) => {
    const mode = value === "" ? null : (value as PermissionMode);
    onChange({ ...active, permission_mode: mode });
  };

  const handleEffortChange = (value: string) => {
    onChange({ ...active, effort: value || null });
  };

  const inputCls =
    "w-full rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-zinc-200 outline-none focus:border-cyan-500/30 disabled:opacity-40 disabled:cursor-not-allowed";

  const autoDisabled = isAutoDisabled(active.vendor, active.model ?? "");

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
            value={active.model ?? ""}
            placeholder={MODEL_PLACEHOLDERS[active.vendor]}
            onChange={(e) => handleModelChange(e.target.value)}
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
              const disabled = opt.value === "auto" && autoDisabled;
              return (
                <option key={opt.value} value={opt.value} disabled={disabled}>
                  {opt.label}
                  {opt.value === "auto" && autoDisabled ? " (requires opus-tier model)" : ""}
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
