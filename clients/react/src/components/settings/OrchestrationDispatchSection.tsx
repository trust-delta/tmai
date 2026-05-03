import { useCallback, useEffect, useRef, useState } from "react";
import type { AutoSaveStatus } from "@/hooks/useAutoSave";
import { api } from "@/lib/api";
import type { DispatchBundle } from "@/types/generated/DispatchBundle";
import type { WorkerDispatchMap } from "@/types/generated/WorkerDispatchMap";
import { DispatchBundleEditor } from "./DispatchBundleEditor";
import { SaveStatus } from "./SaveStatus";

interface DispatchState {
  orchestrator: DispatchBundle | null;
  dispatch: WorkerDispatchMap;
}

/**
 * A "role" describes one editable bundle: how to read it from state and how to
 * write a new bundle back. Keeping orchestrator / implementer / reviewer as
 * data here rather than three near-identical handler triplets lets the render
 * loop stay declarative.
 */
interface DispatchRole {
  title: string;
  subtitle: string;
  read: (s: DispatchState) => DispatchBundle | null;
  write: (s: DispatchState, bundle: DispatchBundle | null) => DispatchState;
}

const ROLES: DispatchRole[] = [
  {
    title: "Orchestrator",
    subtitle: "the agent you attach to",
    read: (s) => s.orchestrator,
    write: (s, bundle) => ({ ...s, orchestrator: bundle }),
  },
  {
    title: "Implementer",
    subtitle: "dispatch_issue / spawn_worktree",
    read: (s) => s.dispatch.implementer ?? null,
    write: (s, bundle) => ({ ...s, dispatch: { ...s.dispatch, implementer: bundle } }),
  },
  {
    title: "Reviewer",
    subtitle: "dispatch_review",
    read: (s) => s.dispatch.reviewer ?? null,
    write: (s, bundle) => ({ ...s, dispatch: { ...s.dispatch, reviewer: bundle } }),
  },
];

/**
 * Settings section that exposes per-role dispatch bundle editing for
 * orchestrator / implementer / reviewer (#578 — auto-save).
 *
 * Atomic fields (vendor / permission_mode / effort dropdowns and the "Use
 * vendor CLI default" checkbox) persist on change; the model text field
 * persists on blur or Enter so we do not flicker validation errors mid-typing.
 *
 * Reads the bundles from `GET /settings/orchestrator` (the global settings
 * endpoint that carries the dispatch fields alongside notify/guardrails/...)
 * and saves them via the same endpoint's PUT — server-side `OrchestrationSettings`
 * is the single source of truth, so this component only roundtrips the dispatch
 * subset of fields.
 *
 * Backend 400s surface as inline error text. For atomic changes we roll back
 * to the last-saved bundle; for text-commit errors we leave the user's draft
 * in place so they can correct it.
 */
export function OrchestrationDispatchSection() {
  const [state, setState] = useState<DispatchState | null>(null);
  const [status, setStatus] = useState<AutoSaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const lastSavedRef = useRef<DispatchState | null>(null);
  const fadeRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    api
      .getOrchestratorSettings()
      .then((s) => {
        const initial = {
          orchestrator: s.orchestrator ?? null,
          dispatch: s.dispatch,
        };
        setState(initial);
        lastSavedRef.current = initial;
      })
      .catch(console.error);
    return () => {
      if (fadeRef.current !== null) clearTimeout(fadeRef.current);
    };
  }, []);

  const persist = useCallback(
    async (next: DispatchState, options: { rollbackOnError: boolean }) => {
      if (fadeRef.current !== null) clearTimeout(fadeRef.current);
      setStatus("saving");
      setError(null);
      try {
        await api.updateOrchestratorSettings({
          orchestrator: next.orchestrator,
          dispatch: next.dispatch,
        });
        lastSavedRef.current = next;
        setStatus("saved");
        fadeRef.current = setTimeout(() => {
          fadeRef.current = null;
          setStatus((s) => (s === "saved" ? "idle" : s));
        }, 1000);
      } catch (e) {
        if (options.rollbackOnError && lastSavedRef.current) {
          setState(lastSavedRef.current);
        }
        setStatus("error");
        setError(e instanceof Error ? e.message : "Save failed");
      }
    },
    [],
  );

  if (!state) return null;

  // Build the three handler triplets from the ROLES table. Each role differs
  // only by its read/write lens; the persistence semantics (atomic = persist
  // immediately with rollback, text draft = local-only + clear error, text
  // commit = persist without rollback) are identical, so we keep them in a
  // single place.
  const handlersFor = (role: DispatchRole) => ({
    onAtomicChange: (bundle: DispatchBundle | null) => {
      const next = role.write(state, bundle);
      setState(next);
      void persist(next, { rollbackOnError: true });
    },
    onTextDraft: (bundle: DispatchBundle | null) => {
      setState(role.write(state, bundle));
      if (status === "error") {
        setStatus("idle");
        setError(null);
      }
    },
    onTextCommit: (bundle: DispatchBundle | null) => {
      const next = role.write(state, bundle);
      setState(next);
      void persist(next, { rollbackOnError: false });
    },
  });

  return (
    <section>
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium text-zinc-300">Orchestration dispatch</h3>
        <SaveStatus status={status} error={error} variant="section" />
      </div>
      <p className="mt-1 text-xs text-zinc-600">
        Per-role dispatch bundles: vendor, model, permission mode, and effort for each agent role.
        Leave "Use vendor CLI default" checked to launch that role with the vendor CLI's own
        defaults (no <code>--model</code> / <code>--permission-mode</code> flags injected).
      </p>

      <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.02] p-3 space-y-3">
        {ROLES.map((role) => {
          const handlers = handlersFor(role);
          return (
            <DispatchBundleEditor
              key={role.title}
              title={role.title}
              subtitle={role.subtitle}
              bundle={role.read(state)}
              onAtomicChange={handlers.onAtomicChange}
              onTextDraft={handlers.onTextDraft}
              onTextCommit={handlers.onTextCommit}
            />
          );
        })}
      </div>
    </section>
  );
}
