import { useCallback, useEffect, useRef, useState } from "react";
import { api, type IssueInfo, type WorktreeSnapshot } from "@/lib/api";
import { extractIssueNumbers, issueToWorktreeName } from "@/lib/issue-utils";

interface IssueActionViewProps {
  /** Issue selected in the Issues tab. `null` shows an empty placeholder. */
  selectedIssue: IssueInfo | null;
  /** Repository default branch — used as the base for worktree creation. */
  defaultBranch?: string;
  /** Snapshot of registered worktrees for the project; we look up an existing
   *  worktree whose branch references the selected issue's number. */
  worktrees?: WorktreeSnapshot[];
  /** Project path passed to `api.spawnWorktree`. */
  projectPath: string;
  /** Caller-side navigation: jump the user to an existing worktree's branch. */
  onSelectWorktreeBranch?: (branch: string) => void;
  /** Caller-side navigation: jump the user to the just-created worktree. */
  onStartWorkDone?: (worktreeName: string) => void;
}

/**
 * Right-rail panel shown while the Issues tab has focus. Two modes:
 * - **Existing worktree** for this issue: surface its agent status + a
 *   "Go to Worktree" button.
 * - **Start Work**: pre-filled name input + Launch / Create-and-Resolve
 *   buttons. Resolve mode includes a Japanese prompt shaped around the
 *   selected issue's number and title.
 *
 * Extracted from `ActionPanel`'s `issueMode === true` branch — issue and
 * branch flows are completely disjoint and were forced through one
 * component only because they share the same right-rail slot. Splitting
 * them lets each side carry only the props it needs (BranchGraph no
 * longer has to thread `EMPTY_PRS` and a synthetic `activeNode` through
 * here).
 */
export function IssueActionView({
  selectedIssue,
  defaultBranch,
  worktrees,
  projectPath,
  onSelectWorktreeBranch,
  onStartWorkDone,
}: IssueActionViewProps) {
  const [startWorkName, setStartWorkName] = useState("");
  const [startWorkBusy, setStartWorkBusy] = useState(false);
  const [startWorkError, setStartWorkError] = useState<string | null>(null);
  const startWorkInputRef = useRef<HTMLInputElement>(null);

  // Pre-fill the worktree name from the selected issue and focus the input.
  useEffect(() => {
    if (selectedIssue) {
      setStartWorkName(issueToWorktreeName(selectedIssue));
      setStartWorkError(null);
      setStartWorkBusy(false);
      // Focus runs after render — the timeout (rather than a useLayoutEffect)
      // gives the slide-in animation room to start before the focus jump.
      setTimeout(() => startWorkInputRef.current?.focus(), 50);
    }
  }, [selectedIssue]);

  const buildResolvePrompt = useCallback(
    (issue: IssueInfo) =>
      `GitHub Issue #${issue.number} "${issue.title}" に対応してください。\n\nまず \`gh issue view ${issue.number}\` でissueの詳細を確認し、実装方針を立ててください。\n実装・テスト完了後、PRを作成してください（Closes #${issue.number} をPR本文に含めること）。`,
    [],
  );

  const handleStartWork = useCallback(
    async (initialPrompt?: string) => {
      if (!selectedIssue || startWorkBusy || !startWorkName.trim()) return;
      const trimmed = startWorkName.trim();
      if (!/^[a-zA-Z0-9_-]+$/.test(trimmed) || trimmed.length > 64) {
        setStartWorkError("a-z, 0-9, -, _ only (max 64)");
        return;
      }
      setStartWorkBusy(true);
      setStartWorkError(null);
      try {
        const base = defaultBranch ?? "main";
        await api.spawnWorktree({
          name: trimmed,
          cwd: projectPath,
          base_branch: base,
          ...(initialPrompt ? { initial_prompt: initialPrompt } : {}),
        });
        onStartWorkDone?.(trimmed);
      } catch (e) {
        setStartWorkError(e instanceof Error ? e.message : "Failed to create worktree");
      } finally {
        setStartWorkBusy(false);
      }
    },
    [selectedIssue, startWorkBusy, startWorkName, defaultBranch, projectPath, onStartWorkDone],
  );

  // Look up an existing worktree whose branch references the selected
  // issue. `is_main` worktrees are skipped — they exist for every project.
  const matchingWorktree = (() => {
    if (!selectedIssue || !worktrees) return null;
    for (const wt of worktrees) {
      if (wt.is_main) continue;
      const branch = wt.branch ?? wt.name;
      const nums = extractIssueNumbers(branch);
      if (nums.includes(selectedIssue.number)) return wt;
    }
    return null;
  })();

  return (
    <div className="w-80 shrink-0 overflow-y-auto border-l border-white/5 bg-black/20">
      <div className="p-4">
        {selectedIssue ? (
          <>
            {/* Issue header */}
            <div className="mb-4">
              <div className="flex items-center gap-2">
                <span className="text-lg font-semibold text-green-400">
                  #{selectedIssue.number}
                </span>
                <a
                  href={selectedIssue.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] text-zinc-500 hover:text-zinc-300"
                >
                  open in GitHub
                </a>
              </div>
              <h3 className="mt-1 text-sm font-medium text-zinc-100">{selectedIssue.title}</h3>
              {selectedIssue.labels.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {selectedIssue.labels.map((label) => (
                    <span
                      key={label.name}
                      className="rounded-full px-1.5 py-0.5 text-[10px]"
                      style={{
                        backgroundColor: `#${label.color}22`,
                        color: `#${label.color}`,
                      }}
                    >
                      {label.name}
                    </span>
                  ))}
                </div>
              )}
              {selectedIssue.assignees.length > 0 && (
                <div className="mt-2 text-[11px] text-zinc-500">
                  Assigned: {selectedIssue.assignees.join(", ")}
                </div>
              )}
            </div>

            {matchingWorktree ? (
              /* Existing worktree status */
              <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3">
                <div className="mb-2 text-[11px] font-medium text-cyan-400">
                  {matchingWorktree.agent_status === "in-progress" ||
                  matchingWorktree.agent_status === "waiting"
                    ? "Agent In Progress"
                    : "Worktree Exists"}
                </div>
                <div className="mb-1 text-[11px] text-zinc-400">
                  <span className="text-zinc-500">branch:</span>{" "}
                  <span className="text-cyan-400">
                    {matchingWorktree.branch ?? matchingWorktree.name}
                  </span>
                </div>
                {matchingWorktree.agent_target && (
                  <div className="mb-1 text-[11px] text-zinc-400">
                    <span className="text-zinc-500">agent:</span>{" "}
                    <span className="text-cyan-400">{matchingWorktree.agent_target}</span>
                  </div>
                )}
                {matchingWorktree.agent_status && (
                  <div className="mb-2 text-[11px] text-zinc-400">
                    <span className="text-zinc-500">status:</span>{" "}
                    <span
                      className={
                        matchingWorktree.agent_status === "in-progress" ||
                        matchingWorktree.agent_status === "waiting"
                          ? "text-cyan-400"
                          : "text-amber-400"
                      }
                    >
                      {matchingWorktree.agent_status}
                    </span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => {
                    const branch = matchingWorktree.branch ?? matchingWorktree.name;
                    onSelectWorktreeBranch?.(branch);
                  }}
                  className="mt-1 w-full rounded-lg bg-cyan-500/20 px-3 py-2 text-xs font-medium text-cyan-400 transition-colors hover:bg-cyan-500/30"
                >
                  Go to Worktree
                </button>
              </div>
            ) : (
              /* Start Work form */
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                <div className="mb-2 text-[11px] font-medium text-emerald-400">Start Work</div>
                <div className="mb-1.5 text-[11px] text-zinc-500">
                  base: <span className="text-emerald-400">{defaultBranch ?? "main"}</span>
                </div>
                <div className="flex items-center gap-1">
                  <input
                    ref={startWorkInputRef}
                    type="text"
                    value={startWorkName}
                    onChange={(e) => {
                      setStartWorkName(e.target.value);
                      setStartWorkError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleStartWork();
                    }}
                    placeholder="worktree name"
                    className="flex-1 rounded bg-black/30 px-2 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none ring-1 ring-emerald-500/30 focus:ring-emerald-500/60"
                  />
                </div>
                <div className="mt-1 text-[10px] text-zinc-600">
                  Creates worktree + launches agent
                </div>
                {startWorkError && (
                  <div className="mt-1 text-[10px] text-red-400">{startWorkError}</div>
                )}
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleStartWork()}
                    disabled={!startWorkName.trim() || startWorkBusy}
                    className="flex-1 rounded-lg bg-emerald-500/20 px-3 py-2 text-xs font-medium text-emerald-400 transition-colors hover:bg-emerald-500/30 disabled:opacity-40"
                  >
                    {startWorkBusy ? "Creating..." : "Launch Agent"}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      selectedIssue && handleStartWork(buildResolvePrompt(selectedIssue))
                    }
                    disabled={!startWorkName.trim() || startWorkBusy}
                    className="flex-1 rounded-lg bg-amber-500/20 px-3 py-2 text-xs font-medium text-amber-400 transition-colors hover:bg-amber-500/30 disabled:opacity-40"
                    title="Worktree作成 → issue内容を含むプロンプトでエージェント起動 → 実装・テスト・PR作成まで自動実行"
                  >
                    {startWorkBusy ? "Creating..." : "Create & Resolve ▶"}
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="text-sm text-zinc-500">Select an issue to start work</div>
        )}
      </div>
    </div>
  );
}
