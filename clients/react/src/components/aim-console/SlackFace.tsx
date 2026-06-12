// SlackFace — the AimPane's SLACK face (Stage B, issue #809): the UI half of
// the slack artifact, pre-crystallization aim ore (結晶化前の aim の原石).
// Design carrier: tmai-core `doc/slack/2026-06-11-230025-2.md`
// (recoil-loop-handoff) §6b–6d; wire = the generated `UnitSlackResponse` family (#807).
//
// Design invariants (operator-ratified — load-bearing, do not relax):
//   - TERRAIN, NOT A QUEUE — no unread counters, no badges, no counts, no
//     "mark as read". The face renders what exists; nothing nags.
//   - CAPTURE IS TEXT ONLY — one textarea + a repo target. No category /
//     care-level / importance field of any kind.
//   - quoted/unmined is EDGE-DERIVED — `quoted_by` (same-repo aims citing the
//     ore) renders as a quiet marker; empty = a faint 未採掘. Display only:
//     no stored state, no client-side toggles.
//   - Writer is the operator (this UI). No agent write path.
//
// Data: `useUnitSlack` (60s poll, same conventions as `useUnitPrs`) +
// `api.captureSlack` for the POST; a successful capture clears the box and
// `refresh()`es so the persisted ore appears immediately.

import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { useUnitSlack } from "@/hooks/useUnitSlack";
import { api, type RepoSlackWire, type SlackOreWire } from "@/lib/api";
import { cn } from "@/lib/utils";

// Normalize a thrown API error into a short, operator-readable message — the
// HTTP client throws `Error` whose message carries the backend's text.
function writeErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// An older running engine without the slack routes answers 404, and a
// mid-rebuild engine doesn't answer at all (a fetch-level failure, no
// `API error` prefix). Both are a quiet wait-state — "rebuild 待ち" — NOT an
// error wall. Anything else (500 …) surfaces its message, still quietly.
function terrainErrorNote(error: Error): string {
  const msg = error.message;
  if (msg.includes("API error 404") || !msg.includes("API error")) {
    return "engine が slack 未対応（rebuild 待ち）";
  }
  return `slack の読み込みに失敗: ${msg}`;
}

export function SlackFace({ unitName }: { unitName: string | null }) {
  const { data, loading, error, refresh } = useUnitSlack(unitName);
  const repos = data?.repos ?? [];
  const primaryRepo = repos.find((r) => r.primary) ?? repos[0] ?? null;

  const [text, setText] = useState("");
  // `null` = follow the unit's primary repo (the default target); a string =
  // the operator pinned another repo. Ore never crosses repos — the pin only
  // chooses which repo's doc/slack/ receives the capture.
  const [pinnedRepoPath, setPinnedRepoPath] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const prevUnitRef = useRef(unitName);

  // A unit change invalidates the capture state: a half-typed ore and a
  // pinned repo are meaningless against the NEW unit's repos. Runs only on an
  // actual change (same pattern as AimFace's unit-change reset).
  useEffect(() => {
    if (prevUnitRef.current === unitName) return;
    prevUnitRef.current = unitName;
    setText("");
    setPinnedRepoPath(null);
    setSubmitError(null);
  }, [unitName]);

  // Resolve the target: the pinned repo if it still exists in the wire,
  // else the primary. (A stale pin after a repo disappears falls back.)
  const targetRepo = repos.find((r) => r.repo_path === pinnedRepoPath) ?? primaryRepo;

  // Reject-empty is server-side (422); this is the client-side mirror so the
  // submit affordance never offers a doomed POST.
  const canSubmit = unitName !== null && targetRepo !== null && text.trim() !== "" && !submitting;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit || unitName === null || targetRepo === null) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      // `text` goes verbatim (not trimmed) — the server writes the ore file
      // byte-for-byte; the trim above only gates emptiness.
      await api.captureSlack(unitName, { repo_path: targetRepo.repo_path, text });
      setText("");
      refresh();
    } catch (err) {
      setSubmitError(writeErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  let terrain: ReactNode;
  if (unitName === null) {
    terrain = <div className="ac-hint">プロジェクトを選択すると slack が表示されます。</div>;
  } else if (error !== null) {
    terrain = <div className="ac-hint">{terrainErrorNote(error)}</div>;
  } else if (loading && data === null) {
    terrain = <div className="ac-hint">Loading…</div>;
  } else {
    terrain = repos.map((repo) => <SlackRepoGroup key={repo.repo_path} repo={repo} />);
  }

  return (
    <>
      {/* ── capture box — one textarea, a repo target, a submit. Nothing else. ── */}
      <form className="ac-skcap" data-testid="slack-capture" onSubmit={onSubmit}>
        <textarea
          aria-label="slack capture"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="原石をそのまま置く — 整形しない、分類しない…"
          disabled={unitName === null}
        />
        <div className="ac-skcap-row">
          {repos.length > 1 ? (
            <select
              aria-label="capture target repo"
              value={targetRepo?.repo_path ?? ""}
              onChange={(e) => setPinnedRepoPath(e.target.value)}
            >
              {repos.map((r) => (
                <option key={r.repo_path} value={r.repo_path}>
                  {r.repo_label}
                  {r.primary ? " (primary)" : ""}
                </option>
              ))}
            </select>
          ) : (
            <span className="ac-skcap-repo">{targetRepo?.repo_label ?? "—"}</span>
          )}
          <button type="submit" className="ac-btn primary small" disabled={!canSubmit}>
            {submitting ? "置いています…" : "置く"}
          </button>
        </div>
        {submitError !== null && (
          <p role="alert" className="ac-hint2 err">
            {submitError}
          </p>
        )}
      </form>

      {/* ── ore terrain — per-repo groups, newest first ── */}
      <div className="ac-sklist">{terrain}</div>
    </>
  );
}

// One repo's ore slice — repo banner (primary cyan-accented, same banner
// language as the AIM face's Frontier sections) + the ores newest-first.
function SlackRepoGroup({ repo }: { repo: RepoSlackWire }) {
  // The wire returns ores ascending by ticket (= capture order); the terrain
  // reads reverse-chronological, newest at the top.
  const ores = [...repo.ores].reverse();
  return (
    <div data-testid="slack-repo-group" data-repo={repo.repo_label}>
      <div className={cn("ac-repohead", "frontier", repo.primary && "pri")}>
        <span className="ac-rh-name">{repo.repo_label}</span>
      </div>
      {ores.length === 0 ? (
        <div className="ac-hint">ore なし — この repo にはまだ何も置かれていない。</div>
      ) : (
        ores.map((ore) => <OreRow key={ore.ticket} ore={ore} />)
      )}
    </div>
  );
}

// One ore: capture time (mono, compact) + the quoted/unmined marker on the
// meta line, the verbatim body below (multi-line preserved). Both marker
// states are normal — an ore that never becomes an aim is 正規, so 未採掘
// renders faint, never as a warning.
function OreRow({ ore }: { ore: SlackOreWire }) {
  return (
    <article className="ac-ore" data-testid="slack-ore" data-ticket={ore.ticket}>
      <div className="ac-ore-meta">
        <span className="ac-ore-at">{ore.captured_at}</span>
        {ore.quoted_by.length > 0 ? (
          <span className="ac-ore-q" data-testid="slack-quoted">
            引用: {ore.quoted_by.join(", ")}
          </span>
        ) : (
          <span className="ac-ore-un" data-testid="slack-unmined">
            未採掘
          </span>
        )}
      </div>
      <div className="ac-ore-body">{ore.body}</div>
    </article>
  );
}
