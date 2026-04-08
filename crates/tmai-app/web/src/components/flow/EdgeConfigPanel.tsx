/**
 * Gate node configuration panel (v2).
 *
 * Condition and resolve are built with dropdowns where possible.
 */

import type { ActionType, GateNodeConfig, ResolveStep } from "@/lib/api";

// ---- Known queries and their typical variable names ----
const KNOWN_QUERIES: { query: string; varName: string; description: string }[] = [
  { query: "list_prs", varName: "pr", description: "List open PRs" },
  { query: "get_ci_status", varName: "ci", description: "CI check status" },
  { query: "get_pr_merge_status", varName: "merge_status", description: "PR merge readiness" },
];

const KNOWN_FILTERS: { label: string; expr: string }[] = [
  { label: "Branch matches agent", expr: "item.branch == agent.git_branch" },
  { label: "CI passed", expr: "item.status == 'success'" },
  { label: "No filter", expr: "" },
];

// ---- Condition presets ----
const CONDITION_PRESETS: { label: string; expr: string }[] = [
  { label: "Variable exists (not null)", expr: "{var} != null" },
  { label: "Variable is null", expr: "{var} == null" },
  { label: "String equals", expr: "{var} == '{value}'" },
  { label: "CI passed", expr: "ci.status == 'success'" },
  { label: "PR approved", expr: "merge_status.review_decision == 'approved'" },
  {
    label: "PR approved + CI passed",
    expr: "merge_status.review_decision == 'approved' && merge_status.ci_status == 'success'",
  },
  { label: "Always true", expr: "true" },
  { label: "Custom...", expr: "" },
];

const ACTION_OPTIONS: { value: ActionType; label: string; description: string }[] = [
  { value: "spawn_agent", label: "Spawn Agent", description: "Start a new agent → initial port" },
  { value: "send_message", label: "Send Message", description: "Queue prompt → agent queue port" },
  { value: "merge_pr", label: "Merge PR", description: "Auto-merge (terminal)" },
  { value: "review_pr", label: "Review PR", description: "Post review (terminal)" },
  { value: "rerun_ci", label: "Rerun CI", description: "Retry failed checks (terminal)" },
  { value: "passthrough", label: "Passthrough", description: "Chain to next gate" },
  { value: "noop", label: "No-op", description: "Do nothing" },
];

const inputCls =
  "w-full rounded border border-white/10 bg-white/[0.05] px-2 py-1 font-mono text-xs text-zinc-300 outline-none focus:border-cyan-500/50";
const selectCls =
  "w-full rounded border border-white/10 bg-white/[0.05] px-2 py-1 text-xs text-zinc-300 outline-none focus:border-cyan-500/50";
const labelCls = "text-[10px] text-zinc-500";
const sectionCls = "rounded border border-white/[0.06] bg-white/[0.02] p-2 space-y-1.5";

interface GateConfigPanelProps {
  gate: GateNodeConfig;
  onChange: (updated: GateNodeConfig) => void;
  onDelete: () => void;
}

export function GateConfigPanel({ gate, onChange, onDelete }: GateConfigPanelProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-400">
          <span className="inline-block h-2 w-2 rotate-45 bg-amber-400" />
          Gate
        </h4>
        <button
          type="button"
          onClick={onDelete}
          className="rounded px-1.5 py-0.5 text-[10px] text-red-400/50 hover:bg-red-500/10 hover:text-red-400"
        >
          Delete
        </button>
      </div>

      {/* ID */}
      <label className="block">
        <span className={labelCls}>ID</span>
        <input
          type="text"
          value={gate.id}
          onChange={(e) => onChange({ ...gate, id: e.target.value.trim() })}
          className={inputCls}
        />
      </label>

      {/* Resolve */}
      <div>
        <div className="flex items-center justify-between">
          <span className={labelCls}>Resolve (query before condition)</span>
          {!gate.resolve && (
            <button
              type="button"
              onClick={() =>
                onChange({
                  ...gate,
                  resolve: {
                    name: "pr",
                    query: "list_prs",
                    params: {},
                    filter: null,
                    pick: "first",
                  },
                })
              }
              className="text-[10px] text-cyan-400 hover:text-cyan-300"
            >
              + Add
            </button>
          )}
        </div>
        {gate.resolve && (
          <ResolveEditor
            resolve={gate.resolve}
            onChange={(r) => onChange({ ...gate, resolve: r })}
            onRemove={() => onChange({ ...gate, resolve: null })}
          />
        )}
      </div>

      {/* Condition */}
      <div>
        <span className={labelCls}>Condition</span>
        <ConditionEditor
          condition={gate.condition}
          onChange={(c) => onChange({ ...gate, condition: c })}
        />
      </div>

      {/* Then action */}
      <div>
        <span className="text-[10px] font-medium text-emerald-400">Then (condition true) →</span>
        <ActionEditor
          action={gate.then_action}
          onChange={(a) => onChange({ ...gate, then_action: a })}
        />
      </div>

      {/* Else action */}
      <div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-medium text-rose-400">Else (condition false) →</span>
          {!gate.else_action ? (
            <button
              type="button"
              onClick={() =>
                onChange({
                  ...gate,
                  else_action: { action: "send_message", target: null, prompt: null, params: {} },
                })
              }
              className="text-[10px] text-rose-400/50 hover:text-rose-400"
            >
              + Add
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onChange({ ...gate, else_action: null })}
              className="text-[10px] text-red-400/50 hover:text-red-400"
            >
              Remove
            </button>
          )}
        </div>
        {gate.else_action && (
          <ActionEditor
            action={gate.else_action}
            onChange={(a) => onChange({ ...gate, else_action: a })}
          />
        )}
      </div>
    </div>
  );
}

/** Resolve step editor with query dropdown and filter presets */
function ResolveEditor({
  resolve,
  onChange,
  onRemove,
}: {
  resolve: ResolveStep;
  onChange: (r: ResolveStep) => void;
  onRemove: () => void;
}) {
  return (
    <div className={`mt-1 ${sectionCls}`}>
      {/* Query selector */}
      <label className="block">
        <span className={labelCls}>Query</span>
        <select
          value={KNOWN_QUERIES.some((q) => q.query === resolve.query) ? resolve.query : "__custom"}
          onChange={(e) => {
            if (e.target.value === "__custom") return;
            const known = KNOWN_QUERIES.find((q) => q.query === e.target.value);
            if (known) {
              onChange({ ...resolve, query: known.query, name: known.varName });
            }
          }}
          className={selectCls}
        >
          {KNOWN_QUERIES.map((q) => (
            <option key={q.query} value={q.query}>
              {q.query} — {q.description}
            </option>
          ))}
          {!KNOWN_QUERIES.some((q) => q.query === resolve.query) && (
            <option value="__custom">{resolve.query} (custom)</option>
          )}
        </select>
      </label>

      {/* Variable name */}
      <div className="flex gap-2">
        <label className="block flex-1">
          <span className={labelCls}>Variable name</span>
          <input
            type="text"
            value={resolve.name}
            onChange={(e) => onChange({ ...resolve, name: e.target.value })}
            className={inputCls}
          />
        </label>
        <label className="block w-20">
          <span className={labelCls}>Pick</span>
          <select
            value={resolve.pick}
            onChange={(e) => onChange({ ...resolve, pick: e.target.value as ResolveStep["pick"] })}
            className={selectCls}
          >
            <option value="first">first</option>
            <option value="last">last</option>
            <option value="count">count</option>
            <option value="all">all</option>
          </select>
        </label>
      </div>

      {/* Filter */}
      <label className="block">
        <span className={labelCls}>Filter</span>
        <select
          value={
            KNOWN_FILTERS.some((f) => f.expr === (resolve.filter ?? ""))
              ? (resolve.filter ?? "")
              : "__custom"
          }
          onChange={(e) => {
            if (e.target.value === "__custom") return;
            onChange({ ...resolve, filter: e.target.value || null });
          }}
          className={selectCls}
        >
          {KNOWN_FILTERS.map((f) => (
            <option key={f.expr} value={f.expr}>
              {f.label}
            </option>
          ))}
          {!KNOWN_FILTERS.some((f) => f.expr === (resolve.filter ?? "")) && resolve.filter && (
            <option value="__custom">Custom: {resolve.filter}</option>
          )}
        </select>
        {resolve.filter !== null && !KNOWN_FILTERS.some((f) => f.expr === resolve.filter) && (
          <input
            type="text"
            value={resolve.filter ?? ""}
            onChange={(e) => onChange({ ...resolve, filter: e.target.value || null })}
            placeholder="item.field == value"
            className={`mt-1 ${inputCls}`}
          />
        )}
      </label>

      <button
        type="button"
        onClick={onRemove}
        className="text-[10px] text-red-400/50 hover:text-red-400"
      >
        Remove resolve
      </button>
    </div>
  );
}

/** Condition editor with presets dropdown + custom input */
function ConditionEditor({
  condition,
  onChange,
}: {
  condition: string;
  onChange: (c: string) => void;
}) {
  const isPreset = CONDITION_PRESETS.some((p) => p.expr === condition);

  return (
    <div className="mt-0.5 space-y-1">
      <select
        value={isPreset ? condition : "__custom"}
        onChange={(e) => {
          if (e.target.value !== "__custom") {
            onChange(e.target.value);
          }
        }}
        className={selectCls}
      >
        {CONDITION_PRESETS.map((p) => (
          <option key={p.expr} value={p.expr}>
            {p.label}
            {p.expr && p.expr !== "true" ? ` — ${p.expr}` : ""}
          </option>
        ))}
        {!isPreset && <option value="__custom">Custom: {condition}</option>}
      </select>
      {/* Always show editable input */}
      <input
        type="text"
        value={condition}
        onChange={(e) => onChange(e.target.value)}
        placeholder="variable != null"
        className={inputCls}
      />
    </div>
  );
}

/** Action editor with typed dropdowns */
function ActionEditor({
  action,
  onChange,
}: {
  action: {
    action: ActionType;
    target: string | null;
    prompt: string | null;
    params: Record<string, unknown>;
  };
  onChange: (a: typeof action) => void;
}) {
  const needsTarget =
    action.action === "send_message" ||
    action.action === "spawn_agent" ||
    action.action === "passthrough";
  const needsPrompt = action.action === "send_message" || action.action === "spawn_agent";

  return (
    <div className={`mt-1 ${sectionCls}`}>
      <label className="block">
        <span className={labelCls}>Action</span>
        <select
          value={action.action}
          onChange={(e) => onChange({ ...action, action: e.target.value as ActionType })}
          className={selectCls}
        >
          {ACTION_OPTIONS.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
        <span className="mt-0.5 block text-[9px] text-zinc-600">
          {ACTION_OPTIONS.find((a) => a.value === action.action)?.description}
        </span>
      </label>

      {needsTarget && (
        <label className="block">
          <span className={labelCls}>Target node ID</span>
          <input
            type="text"
            value={action.target ?? ""}
            onChange={(e) => onChange({ ...action, target: e.target.value || null })}
            placeholder="agent_1"
            className={inputCls}
          />
        </label>
      )}

      {needsPrompt && (
        <label className="block">
          <span className={labelCls}>Prompt</span>
          <textarea
            value={action.prompt ?? ""}
            onChange={(e) => onChange({ ...action, prompt: e.target.value || null })}
            placeholder="PR #{{pr.number}} をレビュー"
            rows={2}
            className={`${inputCls} resize-y`}
          />
        </label>
      )}
    </div>
  );
}
