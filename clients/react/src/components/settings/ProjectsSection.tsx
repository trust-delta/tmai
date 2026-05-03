import { useState } from "react";
import { DirBrowser } from "@/components/project/DirBrowser";
import { api } from "@/lib/api";

interface ProjectsSectionProps {
  /** Project paths registered globally; rendered both here and in the
   *  orchestration scope selector, so the parent owns the list and passes
   *  it down. */
  projects: string[];
  /** Re-fetch the project list from the backend after add/remove so the
   *  parent's copy stays in sync. */
  refreshProjects: () => void;
  /** Notify the App so it can refresh the sidebar's project tree. */
  onProjectsChanged: () => void;
}

/**
 * Settings section for managing the registered project directories.
 * Owns the local add-flow state (`path` input, DirBrowser visibility,
 * inline error) but defers the canonical project list to the parent —
 * the orchestration scope selector also reads it.
 */
export function ProjectsSection({
  projects,
  refreshProjects,
  onProjectsChanged,
}: ProjectsSectionProps) {
  const [path, setPath] = useState("");
  const [browsing, setBrowsing] = useState(false);
  const [error, setError] = useState("");

  const handleAdd = async (projectPath?: string) => {
    const trimmed = (projectPath ?? path).trim();
    if (!trimmed) return;
    setError("");
    try {
      await api.addProject(trimmed);
      setPath("");
      setBrowsing(false);
      refreshProjects();
      onProjectsChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add project");
    }
  };

  const handleRemove = async (projectPath: string) => {
    try {
      await api.removeProject(projectPath);
      refreshProjects();
      onProjectsChanged();
    } catch (_e) {}
  };

  return (
    <section>
      <h3 className="text-sm font-medium text-zinc-300">Projects</h3>
      <p className="mt-1 text-xs text-zinc-600">
        Registered directories appear in the sidebar even with no agents running.
      </p>

      {/* Add project — always visible */}
      <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.02] p-3">
        <div className="flex gap-1.5">
          <input
            type="text"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleAdd();
            }}
            placeholder="/path/to/project"
            className="flex-1 rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-cyan-500/30"
            aria-label="Project path"
          />
          <button
            type="button"
            onClick={() => void handleAdd()}
            className="rounded-md bg-cyan-500/20 px-3 py-1.5 text-xs text-cyan-400 transition-colors hover:bg-cyan-500/30"
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => setBrowsing((v) => !v)}
            className={`rounded-md border border-white/10 px-3 py-1.5 text-xs transition-colors hover:bg-white/10 ${
              browsing ? "text-cyan-400" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Browse
          </button>
        </div>
        {error && <p className="mt-1.5 text-[11px] text-red-400">{error}</p>}
        {browsing && (
          <div className="mt-2">
            <DirBrowser
              onSelect={(selected) => void handleAdd(selected)}
              onCancel={() => setBrowsing(false)}
            />
          </div>
        )}
      </div>

      {/* Project list */}
      <div className="mt-3 space-y-1">
        {projects.length === 0 && (
          <p className="py-4 text-center text-xs text-zinc-600">No projects registered</p>
        )}
        {projects.map((p) => (
          <div
            key={p}
            className="group flex items-center gap-2 rounded-lg px-3 py-2 transition-colors hover:bg-white/5"
          >
            <span className="text-xs text-zinc-500">●</span>
            <div className="flex-1 truncate">
              <span className="text-sm text-zinc-300">{p.split("/").filter(Boolean).pop()}</span>
              <span className="ml-2 text-[11px] text-zinc-600">{p}</span>
            </div>
            <button
              type="button"
              onClick={() => void handleRemove(p)}
              className="shrink-0 rounded px-2 py-0.5 text-xs text-zinc-600 opacity-0 transition-all hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
              aria-label={`Remove project ${p}`}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
