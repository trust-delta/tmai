import { useEffect, useState } from "react";
import { DirBrowser } from "@/components/project/DirBrowser";
import { useSaveTracker } from "@/hooks/useSaveTracker";
import { api, type GeneralSettings } from "@/lib/api";
import { SaveStatus } from "./SaveStatus";

const INPUT_CLS =
  "flex-1 min-w-0 rounded-md border border-hairline-strong bg-surface px-2.5 py-1.5 text-xs text-foreground placeholder-subtle-foreground outline-none focus:border-primary/30";

/**
 * General preferences shared across the WebUI. Today this is a single
 * `default_project_root` field that seeds the directory browser; the
 * section exists so future general-purpose UI prefs (theme defaults,
 * locale, etc.) can land alongside without crowding existing sections.
 *
 * Empty-string drafts are sent as `null` to the backend (PUT clears the
 * key) so the saved state mirrors what the user sees in the input.
 */
export function GeneralSection() {
  const [general, setGeneral] = useState<GeneralSettings | null>(null);
  const [draft, setDraft] = useState("");
  const [browsing, setBrowsing] = useState(false);
  const save = useSaveTracker();

  useEffect(() => {
    api
      .getGeneralSettings()
      .then((g) => {
        setGeneral(g);
        setDraft(g.default_project_root ?? "");
      })
      .catch(() => {});
  }, []);

  if (!general) return null;

  const commit = (value: string) => {
    const trimmed = value.trim();
    const next = trimmed === "" ? null : trimmed;
    if (next === general.default_project_root) return;
    const prev = general;
    setGeneral({ ...general, default_project_root: next });
    // Mirror the normalised value back into the input so the displayed text
    // matches what was actually persisted (e.g. trailing whitespace gone).
    setDraft(next ?? "");
    void save.track(() => api.updateGeneralSettings({ default_project_root: next }), {
      onError: () => {
        setGeneral(prev);
        setDraft(prev.default_project_root ?? "");
      },
    });
  };

  return (
    <section>
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium text-foreground">General</h3>
        <SaveStatus status={save.status} error={save.error} variant="section" />
      </div>
      <p className="mt-1 text-xs text-subtle-foreground">
        Workspace-wide preferences for the WebUI.
      </p>

      <div className="mt-3 rounded-lg border border-hairline-strong bg-surface p-3 space-y-2">
        <span className="block text-xs text-muted-foreground">Default project root</span>
        <p className="text-[11px] text-subtle-foreground">
          Starting directory used by the project picker. Leave empty to default to your home
          directory.
        </p>
        <div className="flex gap-1.5">
          <input
            type="text"
            value={draft}
            onChange={(e) => {
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
            placeholder="/home/works"
            className={INPUT_CLS}
            aria-label="Default project root"
          />
          <button
            type="button"
            onClick={() => setBrowsing(true)}
            className="shrink-0 rounded-md border border-hairline-strong px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-surface-strong hover:text-foreground"
          >
            Browse
          </button>
        </div>
      </div>

      {browsing && (
        <DirBrowser
          startPath={draft.trim() || undefined}
          onSelect={(path) => {
            setDraft(path);
            setBrowsing(false);
            commit(path);
          }}
          onCancel={() => setBrowsing(false)}
        />
      )}
    </section>
  );
}
