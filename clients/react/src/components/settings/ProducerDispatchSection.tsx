import { useCallback, useEffect, useRef, useState } from "react";
import type { AutoSaveStatus } from "@/hooks/useAutoSave";
import { api } from "@/lib/api";
import type { DispatchBundle } from "@/types/generated/DispatchBundle";
import type { WorkerDispatchMap } from "@/types/generated/WorkerDispatchMap";
import { DispatchBundleEditor } from "./DispatchBundleEditor";
import { SaveStatus } from "./SaveStatus";

interface DispatchState {
  dispatch: WorkerDispatchMap;
}

/**
 * A "role" describes one editable bundle: how to read it from state and how to
 * write a new bundle back. Keeping each role as data here rather than
 * near-identical handler triplets lets the render loop stay declarative.
 */
interface DispatchRole {
  title: string;
  subtitle: string;
  read: (s: DispatchState) => DispatchBundle | null;
  write: (s: DispatchState, bundle: DispatchBundle | null) => DispatchState;
}

const ROLES: DispatchRole[] = [
  {
    title: "Implementer",
    subtitle: "spawn_worktree",
    read: (s) => s.dispatch.implementer ?? null,
    write: (s, bundle) => ({ ...s, dispatch: { ...s.dispatch, implementer: bundle } }),
  },
];

/**
 * Settings section that exposes per-role dispatch bundle editing
 * (#578 — auto-save).
 *
 * Atomic fields (vendor / permission_mode / effort dropdowns and the "Use
 * vendor CLI default" checkbox) persist on change; the model text field
 * persists on blur or Enter so we do not flicker validation errors mid-typing.
 *
 * Reads the bundles from `GET /settings/producer` (the global settings
 * endpoint that carries the dispatch fields) and saves them via the same
 * endpoint's PUT — server-side `ProducerSettings` is the single source
 * of truth, so this component only roundtrips the dispatch subset of fields.
 *
 * Backend 400s surface as inline error text. For atomic changes we roll back
 * to the last-saved bundle; for text-commit errors we leave the user's draft
 * in place so they can correct it.
 */
export function ProducerDispatchSection() {
  const [state, setState] = useState<DispatchState | null>(null);
  const [status, setStatus] = useState<AutoSaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const lastSavedRef = useRef<DispatchState | null>(null);
  const fadeRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    api
      .getProducerSettings()
      .then((s) => {
        const initial = {
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
        await api.updateProducerSettings({
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

  // Build the handler triplet for each role in the ROLES table. Each role
  // differs only by its read/write lens; the persistence semantics (atomic = persist
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
        <h3 className="text-sm font-medium text-foreground">Producer dispatch</h3>
        <SaveStatus status={status} error={error} variant="section" />
      </div>
      <p className="mt-1 text-xs text-subtle-foreground">
        Per-role dispatch bundles: vendor, model, permission mode, and effort for each agent role.
        Leave "Use vendor CLI default" checked to launch that role with the vendor CLI's own
        defaults (no <code>--model</code> / <code>--permission-mode</code> flags injected).
      </p>

      <div className="mt-3 rounded-lg border border-hairline-strong bg-surface p-3 space-y-3">
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
