// Per-artifact attention hook — the clients/react half of the attention
// model (contract
// `tmai-core:doc/approaches/2026-06-04-attention-as-per-artifact-field.md`
// §1 model + §3 core). Consumes `GET /api/units/{unit}/attention` (the
// (section,id)→level map) and `POST /api/units/{unit}/attention` (the
// operator's `low`/`high` write).
//
// The attention twin of `useUnitInventory` / `useUnitIssues` — same poll
// shape and cadence (60s, no SSE yet; keeps the last response visible while
// a re-fetch is in flight so markers do not flicker; `loading` reflects only
// the initial fetch; `unit = null` parks the hook). It adds two
// attention-specific affordances the inventory siblings do not need:
//
//   - `levelFor(repo_path, section, id)` — the per-artifact lookup the R-panel
//     rows render. Absence = `null` (the wire only emits `low`/`high`; `null`
//     is a machine fact represented by absence, never sent).
//   - `setAttention(repo_path, section, id, level)` — the operator write.
//     `level` is `Level` (`low`/`high`) — the operator can never set `null`
//     (the type itself forbids it). The POST returns the full updated map,
//     which we stamp over `data` so a server-side demotion (a prior `high`
//     knocked to `low` to keep `high`≤1/dimension) is reflected across every
//     section at once — the reason this hook is lifted to one instance in
//     `RPanel` rather than one per section.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type AttentionSetRequest,
  type AttentionStateResponse,
  api,
  type Level,
  type Section,
} from "@/lib/api";

const POLL_INTERVAL_MS = 60_000;

// Map key for the (repo_path,section,id) composite. `repo_path` is prepended
// so two same-numbered artifacts in different repos (`tmai` PR#5 vs
// `tmai-core` PR#5 — #493/#494) stay distinct. `Section` is a closed enum
// whose variants contain no whitespace, so the space joiner is unambiguous
// even if a repo path contained a space: the section token is always a fixed,
// non-empty enum value flanked by spaces, so no other (repo_path,section,id)
// split reproduces the same string.
function attentionKey(repoPath: string, section: Section, id: string): string {
  return `${repoPath} ${section} ${id}`;
}

export interface UseUnitAttentionResult {
  data: AttentionStateResponse | null;
  loading: boolean;
  error: Error | null;
  /** Operator-set attention for one artifact, or `null` (machine fact: the
   *  wire emits only `low`/`high`, so absence = `null`). Keyed by repo so two
   *  same-numbered artifacts in different repos stay independent. */
  levelFor: (repoPath: string, section: Section, id: string) => Level | null;
  /** Write `low`/`high` for one artifact (POST) and re-render from the
   *  returned map. No `null` pole — the operator cannot disclaim. */
  setAttention: (repoPath: string, section: Section, id: string, level: Level) => Promise<void>;
  /** `attentionKey(repoPath,section,id)` of the artifact whose POST is in
   *  flight, so a row can show a busy/disabled marker; `null` when none is
   *  pending. */
  settingKey: string | null;
}

// The slice an R-panel row needs to render + drive its attention marker —
// threaded down from the single `RPanel` hook instance so a server-side
// demotion lands across every section at once. The poll bookkeeping
// (`data`/`loading`/`error`) stays in the hook; rows do not see it.
export type AttentionControls = Pick<
  UseUnitAttentionResult,
  "levelFor" | "setAttention" | "settingKey"
>;

export function useUnitAttention(unit: string | null): UseUnitAttentionResult {
  const [data, setData] = useState<AttentionStateResponse | null>(null);
  const [loading, setLoading] = useState(unit !== null);
  const [error, setError] = useState<Error | null>(null);
  const [settingKey, setSettingKey] = useState<string | null>(null);
  // An in-flight response from a previous unit must not stamp over a newer
  // unit's data (same guard as useUnitIssues / useUnitInventory). The POST
  // path reads it too, so a write that resolves after a unit switch is
  // dropped rather than written under the wrong unit.
  const generationRef = useRef(0);
  // Per-write sequence — `generationRef` only changes per unit, so two
  // concurrent SAME-unit POSTs would both pass that guard and a slower (older)
  // response could overwrite a newer one. Each write claims a monotonically
  // increasing seq; only the latest seq's response is allowed to stamp `data`
  // / clear `settingKey`. (Last-write-wins regardless of resolution order.)
  const writeSeqRef = useRef(0);

  useEffect(() => {
    if (!unit) {
      // Bump the generation here too: parking must invalidate any in-flight
      // GET/POST from the previous unit, or a late response would pass its
      // `myGen === generationRef.current` guard and revive stale data after
      // we cleared it. (The non-null branch below bumps on every unit change;
      // the null branch was the hole.)
      ++generationRef.current;
      setData(null);
      setLoading(false);
      setError(null);
      setSettingKey(null);
      return;
    }
    const myGen = ++generationRef.current;
    // Clear on unit *change* so the previous unit's attention is never shown
    // under the new unit's rows. The 60s same-unit re-poll goes through
    // fetchOnce, which keeps the last response visible (anti-flicker); that
    // path is untouched. Mirrors the guard in useUnitIssues.
    setData(null);
    setError(null);
    setSettingKey(null);
    setLoading(true);

    const fetchOnce = async () => {
      try {
        const res = await api.unitAttention(unit);
        if (myGen !== generationRef.current) return;
        setData(res);
        setError(null);
      } catch (e) {
        if (myGen !== generationRef.current) return;
        setError(e instanceof Error ? e : new Error(String(e)));
      } finally {
        if (myGen === generationRef.current) {
          setLoading(false);
        }
      }
    };

    void fetchOnce();
    const id = window.setInterval(() => {
      void fetchOnce();
    }, POLL_INTERVAL_MS);

    return () => {
      // Bump the generation so this effect's in-flight GET *and* any in-flight
      // setAttention POST (both gate on `generationRef`) are dropped after
      // unmount. Without it a response resolving post-unmount calls setState on
      // a gone component, and React 19's resolveUpdatePriority reads `window` —
      // which the jsdom test teardown has removed (`ReferenceError: window is
      // not defined`, failing the whole suite). This hook keeps its bespoke
      // shape (POST write-back + writeSeq) rather than usePolledResource, so it
      // carries the same guard inline.
      ++generationRef.current;
      window.clearInterval(id);
    };
  }, [unit]);

  const levelMap = useMemo(() => {
    const map = new Map<string, Level>();
    if (data !== null) {
      for (const entry of data.entries) {
        map.set(attentionKey(entry.repo_path, entry.section, entry.id), entry.level);
      }
    }
    return map;
  }, [data]);

  const levelFor = useCallback(
    (repoPath: string, section: Section, id: string): Level | null =>
      levelMap.get(attentionKey(repoPath, section, id)) ?? null,
    [levelMap],
  );

  const setAttention = useCallback(
    async (repoPath: string, section: Section, id: string, level: Level): Promise<void> => {
      if (!unit) return;
      const myGen = generationRef.current;
      const myWriteSeq = ++writeSeqRef.current;
      // Stale iff the unit changed (myGen) OR a newer write superseded this one
      // (myWriteSeq). Either invalidates this response.
      const isStale = () => myGen !== generationRef.current || myWriteSeq !== writeSeqRef.current;
      const key = attentionKey(repoPath, section, id);
      setSettingKey(key);
      const body: AttentionSetRequest = { repo_path: repoPath, section, id, level };
      try {
        const res = await api.setUnitAttention(unit, body);
        if (isStale()) return;
        // Stamp the full returned map so a server-side demotion (prior `high`
        // → `low`) lands across every section at once.
        setData(res);
        setError(null);
      } catch (e) {
        if (isStale()) return;
        setError(e instanceof Error ? e : new Error(String(e)));
      } finally {
        if (!isStale()) {
          setSettingKey(null);
        }
      }
    },
    [unit],
  );

  return { data, loading, error, levelFor, setAttention, settingKey };
}

// Re-exported so consumers (the R-panel sections / marker) can build the same
// busy-key the hook reports via `settingKey` without re-deriving the joiner.
export { attentionKey };
