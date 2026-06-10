// BashFooter — the docked bash footer of the aim-console Session pane (S4).
//
// A faithful reproduction of the mock's `.footer` (`origin/mock/aim-ui-sample`
// → `assets/ui-sample.html`, the `.footer`/`.fbar`/`.ftab`/`.ftwrap` chrome +
// the `terms[]` / renderFt / switchTerm / addTerm / split / collapse JS), in
// the aim-console dev-tool tokens (`.ac-footer` / `.ac-fbar` / `.ac-ftab` /
// `.ac-ftwrap`). It docks at the bottom of the Session pane, replacing S3's
// `.ac-sfoot` reservation strip.
//
// REUSE, DON'T REBUILD (issue #799): the shell-terminal primitives already
// exist — this footer does NOT add a new PTY layer.
//   - `api.spawnPty({ command: "bash", cwd })` opens a shell PTY in a repo's
//     cwd (`bash` is an existing spawn-allow-list runtime);
//   - `TerminalPanel` renders the live PTY by the resolved agent target
//     (reused AS-IS — its internals are untouched);
//   - the live agent list (App's `useAgents`, threaded in as `agents`) lets
//     the footer DISCOVER an already-running bash for a repo's cwd and
//     RE-ATTACH to it rather than spawn a duplicate.
//
// LAZY SPAWN (load-bearing resource hygiene): these are real OS processes.
// NOTHING is spawned on mount — the footer mounts COLLAPSED with no live
// terminal. A repo's PTY is spawned (or re-attached) only when its tab is
// first surfaced (the footer opened onto it, the tab clicked, or split made it
// the partner pane). Ad-hoc shells spawn on the explicit `+`. Closing an
// ad-hoc tab kills its PTY (`api.killAgent`) so we never strand orphan shells.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TerminalPanel } from "@/components/terminal/TerminalPanel";
import { type AgentSnapshot, api, isAiAgentLoose, normalizeGitDir } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { UnitRepoWire } from "@/types/generated/UnitRepoWire";

interface BashFooterProps {
  /** The focused unit's repos (primary first; the same `repos[]` order the
   *  top-bar tab uses). One per-repo bash tab each. Empty for a
   *  cwd-synthesized unit not in the configured membership — then the footer
   *  falls back to a single tab at `primaryPath`. */
  repos: UnitRepoWire[];
  /** The unit's primary repo cwd — ad-hoc shells (`sh-N`) spawn here, and it
   *  is the fallback single repo when `repos` is empty. `null` when no unit /
   *  project is focused (the footer then shows only the `+` affordance). */
  primaryPath: string | null;
  /** Live agent list (App's `useAgents`). Read to discover already-running
   *  bash sessions (re-attach over duplicate) and to resolve a spawned
   *  `session_id` → the canonical agent target `TerminalPanel` subscribes on
   *  (the same id mapping the existing console uses). */
  agents: AgentSnapshot[];
}

type TabKind = "repo" | "adhoc";

interface FooterTab {
  /** Stable key — `repo:<path>` for a per-repo tab, `adhoc:<seq>` for an
   *  ad-hoc shell. Keys the React list, the active-tab tracking, and the
   *  lazy-spawn session map. */
  key: string;
  kind: TabKind;
  /** Tab caption — a repo basename, or `sh-N` for an ad-hoc shell. */
  label: string;
  /** Spawn cwd for this tab's bash. */
  cwd: string;
  /** Only ad-hoc shells carry the `×` close affordance (mock `closeable`). */
  closeable: boolean;
}

function repoBasename(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

// An already-running plain shell (NOT an AI agent — `isAiAgentLoose` excludes
// the bash-wrapped Producer and the workers) whose cwd is this repo. Found by
// normalized-cwd equality so a footer-spawned `bash` at the repo root
// re-attaches on the next activation instead of leaking a second shell.
function findExistingBash(cwd: string, agents: AgentSnapshot[]): AgentSnapshot | undefined {
  const target = normalizeGitDir(cwd);
  return agents.find((a) => !isAiAgentLoose(a) && normalizeGitDir(a.cwd) === target);
}

// Resolve a stored PTY id (a `spawnPty` `session_id`, or an agent `target`
// from a re-attach) to its live snapshot. `target` is the stable key across
// the provisional→canonical re-key; fall back to `id`, exactly as the
// existing console's `selectedAgent` lookup does.
function resolveAgent(
  storedId: string | undefined,
  agents: AgentSnapshot[],
): AgentSnapshot | undefined {
  if (!storedId) return undefined;
  return agents.find((a) => a.target === storedId || a.id === storedId);
}

export function BashFooter({ repos, primaryPath, agents }: BashFooterProps) {
  // Collapsed (33px tab bar) ↔ expanded (210px) — the mock's `body.bash-on`,
  // local here. Starts COLLAPSED so mount spawns nothing.
  const [open, setOpen] = useState(false);
  const [splitOn, setSplitOn] = useState(false);
  // Per-repo + ad-hoc tab → its live PTY id (a `spawnPty` session_id or a
  // re-attached agent target). A key is absent until its tab is first
  // surfaced — that absence is the lazy-spawn gate.
  const [sessions, setSessions] = useState<Record<string, string>>({});
  const [adhoc, setAdhoc] = useState<FooterTab[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const seqRef = useRef(0);

  // Read `agents` / `sessions` inside the activation + close callbacks without
  // making them (and the spawn effect) re-run on every SSE tick — only the
  // snapshot at the moment of the action matters.
  const agentsRef = useRef(agents);
  agentsRef.current = agents;
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  // In-flight / settled spawn guard, keyed by tab key. Prevents a concurrent
  // double-spawn (StrictMode's double-invoked effect, an agents-driven effect
  // re-run) for the same tab; the key stays once spawned so a resolved tab is
  // never re-spawned. Cleared only on a failed spawn (to allow a retry) or on
  // close. The spawn/kill side effects run OUTSIDE the state updaters (which
  // StrictMode double-invokes) so they fire exactly once.
  const spawningRef = useRef<Set<string>>(new Set());

  // Per-repo tabs (lazy) — derived from the unit's repos, falling back to the
  // primary path for a unit absent from the configured membership.
  const footerRepos: UnitRepoWire[] = useMemo(() => {
    if (repos.length > 0) return repos;
    if (primaryPath) return [{ path: primaryPath, primary: true }];
    return [];
  }, [repos, primaryPath]);

  const tabs: FooterTab[] = useMemo(() => {
    const repoTabs: FooterTab[] = footerRepos.map((r) => ({
      key: `repo:${r.path}`,
      kind: "repo",
      label: repoBasename(r.path),
      cwd: r.path,
      closeable: false,
    }));
    return [...repoTabs, ...adhoc];
  }, [footerRepos, adhoc]);

  // Highlighted tab — the explicit selection if still present, else the first
  // tab (for the chrome; spawning still waits for an actual activation).
  const effectiveActiveKey =
    activeKey && tabs.some((t) => t.key === activeKey) ? activeKey : (tabs[0]?.key ?? null);
  const activeTab = tabs.find((t) => t.key === effectiveActiveKey) ?? null;
  // Split partner — the first OTHER tab (mock `terms.find(t => t.id !== a.id)`).
  // Split needs two tabs to mean anything.
  const partnerTab =
    splitOn && tabs.length >= 2 ? (tabs.find((t) => t.key !== activeTab?.key) ?? null) : null;

  // Lazily spawn (or re-attach) a tab's PTY. Idempotent: a tab that already
  // has a session, or one mid-spawn, is a no-op. The guard is set
  // synchronously BEFORE any await so a re-entrant call (StrictMode's
  // double-invoked effect) can't race a second spawn.
  const activate = useCallback((tab: FooterTab) => {
    if (spawningRef.current.has(tab.key) || sessionsRef.current[tab.key]) return;
    spawningRef.current.add(tab.key);

    // Re-attach BEFORE spawning — re-use an already-running shell at this
    // repo's cwd over leaking a duplicate (per-repo tabs only; ad-hoc shells
    // are always fresh).
    if (tab.kind === "repo") {
      const existing = findExistingBash(tab.cwd, agentsRef.current);
      if (existing) {
        setSessions((cur) => ({ ...cur, [tab.key]: existing.target }));
        return;
      }
    }

    // No live shell to re-use — spawn one. The `session_id` is stored as the
    // tab's PTY id; it resolves to a live agent snapshot once the wire
    // delivers it (the same id the existing console selects on after spawn).
    api
      .spawnPty({ command: "bash", cwd: tab.cwd })
      .then((res) => {
        setSessions((cur) => ({ ...cur, [tab.key]: res.session_id }));
      })
      .catch(() => {
        // Failed — drop the guard so a later activation can retry.
        spawningRef.current.delete(tab.key);
      });
  }, []);

  // The lazy-spawn driver: whenever the footer is OPEN, ensure the surfaced
  // tab(s) have a live PTY. Collapsed → nothing surfaced → nothing spawned
  // (so mount, which starts collapsed, never spawns). Reads `agents` via the
  // ref so this fires on visibility/selection changes, not on every SSE tick.
  useEffect(() => {
    if (!open) return;
    if (activeTab) activate(activeTab);
    if (partnerTab) activate(partnerTab);
  }, [open, activeTab, partnerTab, activate]);

  // ── tab-bar actions ──────────────────────────────────────────────────────
  const openOnto = useCallback((key: string) => {
    setActiveKey(key);
    setOpen(true);
  }, []);

  const toggleOpen = useCallback(() => {
    setOpen((v) => !v);
  }, []);

  const addAdhoc = useCallback(() => {
    if (!primaryPath) return; // no cwd to spawn into
    seqRef.current += 1;
    const key = `adhoc:${seqRef.current}`;
    setAdhoc((prev) => [
      ...prev,
      { key, kind: "adhoc", label: `sh-${seqRef.current}`, cwd: primaryPath, closeable: true },
    ]);
    setActiveKey(key);
    setOpen(true);
  }, [primaryPath]);

  const closeTab = useCallback((key: string) => {
    // Stop the PTY so we don't strand an orphan shell (`api.killAgent` — the
    // same path the existing console's Kill button uses). Resolve to the
    // canonical target if the wire has delivered it; else kill by the stored
    // session id (a valid agent id immediately after spawn). The kill runs
    // OUTSIDE the state updater so it fires exactly once.
    const storedId = sessionsRef.current[key];
    if (storedId) {
      const agent = resolveAgent(storedId, agentsRef.current);
      api.killAgent(agent?.target ?? storedId).catch(() => {});
    }
    spawningRef.current.delete(key);
    setSessions((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setAdhoc((prev) => prev.filter((t) => t.key !== key));
    setActiveKey((cur) => (cur === key ? null : cur));
  }, []);

  const toggleSplit = useCallback(() => {
    setSplitOn((v) => !v);
    setOpen(true);
  }, []);

  // ── render ─────────────────────────────────────────────────────────────
  const renderPane = (tab: FooterTab, withHeader: boolean) => {
    const agent = resolveAgent(sessions[tab.key], agents);
    return (
      <div className="ac-ftpane" key={tab.key}>
        {withHeader && (
          <div className="ac-ftpane-h">
            {tab.label} · {tab.cwd}
          </div>
        )}
        <div className="ac-ftbody">
          {agent ? (
            // Reuse TerminalPanel AS-IS, keyed on the resolved target so a
            // tab switch tears down and re-attaches cleanly (PTY-server
            // replays scrollback — tmai-core #227).
            <TerminalPanel key={agent.target} agentId={agent.target} />
          ) : (
            <div className="ac-fthint">starting bash in {tab.cwd}…</div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div
      className={cn("ac-footer", open && "open")}
      data-testid="aim-bash-footer"
      data-open={open ? "true" : "false"}
    >
      <div className="ac-fbar">
        <div className="ac-ftabs" role="tablist" aria-label="Bash terminals">
          {tabs.map((tab) => {
            const selected = tab.key === effectiveActiveKey;
            const running = tab.closeable
              ? resolveAgent(sessions[tab.key], agents) !== undefined
              : resolveAgent(sessions[tab.key], agents) !== undefined ||
                findExistingBash(tab.cwd, agents) !== undefined;
            return (
              <div
                key={tab.key}
                className={cn("ac-ftab", selected && "on")}
                data-testid={`aim-bash-tab-${tab.label}`}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  className="ac-ftab-btn"
                  onClick={() => openOnto(tab.key)}
                  title={`${tab.label} — ${tab.cwd}`}
                >
                  {running && (
                    <span
                      className="ac-rdot"
                      aria-hidden="true"
                      title="bash running in this repo"
                    />
                  )}
                  <span>{tab.label}</span>
                </button>
                {tab.closeable && (
                  <button
                    type="button"
                    className="ac-fclose"
                    onClick={() => closeTab(tab.key)}
                    title={`Close ${tab.label}`}
                    aria-label={`Close ${tab.label}`}
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <button
          type="button"
          className="ac-fadd"
          onClick={addAdhoc}
          disabled={!primaryPath}
          title="New ad-hoc terminal in the primary repo"
          aria-label="New ad-hoc terminal"
        >
          +
        </button>
        <span className="ac-fsp" />
        <button
          type="button"
          className={cn("ac-fsplit", splitOn && "on")}
          onClick={toggleSplit}
          disabled={tabs.length < 2}
          aria-pressed={splitOn}
          title="Split view (two terminals side by side)"
          aria-label="Toggle split view"
        >
          ⊟
        </button>
        <button
          type="button"
          className="ac-fcar"
          onClick={toggleOpen}
          aria-expanded={open}
          title="Open / close bash"
          aria-label={open ? "Collapse bash footer" : "Expand bash footer"}
        >
          {open ? "▾" : "▴"}
        </button>
      </div>

      {open && (
        <div className={cn("ac-ftwrap", partnerTab && "split")}>
          {activeTab ? (
            partnerTab ? (
              <>
                {renderPane(activeTab, true)}
                {renderPane(partnerTab, true)}
              </>
            ) : (
              renderPane(activeTab, false)
            )
          ) : (
            <div className="ac-fthint">No repo to open a shell in — focus a unit first.</div>
          )}
        </div>
      )}
    </div>
  );
}
