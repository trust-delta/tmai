import { useState } from "react";
import type { useSaveTracker } from "@/hooks/useSaveTracker";
import {
  type AutoActionTemplates,
  api,
  type EventHandling,
  type NotifySettings,
  type NotifyTemplates,
  type OrchestratorSettings,
} from "@/lib/api";
import { buildNotifyEventHelp } from "./notify-event-help";

/** Event definition for notification rows */
interface NotifyEventDef {
  key: keyof Omit<NotifySettings, "templates" | "default_templates">;
  templateKey: keyof NotifyTemplates;
  label: string;
  description: string;
  /** Built-in default mode for this event (mirrors `OrchestratorNotifySettings::default` in core). */
  defaultMode: EventHandling;
  /** Available {{variable}} placeholders for the Notify-mode template */
  variables: string[];
  /** If set, an Auto Action handler exists for this event. */
  autoActionTemplateKey?: keyof AutoActionTemplates;
  /** Available {{variable}} placeholders for the Auto Action template. */
  autoActionVariables?: string[];
  /** One-line description of what Auto Action does for this event (undefined ⇒ unsupported). */
  autoActionBehavior?: string;
}

const NOTIFY_EVENTS: NotifyEventDef[] = [
  {
    key: "on_agent_stopped",
    templateKey: "agent_stopped",
    label: "Agent stopped",
    description: "Sub-agent stopped normally (task completed)",
    defaultMode: "notify",
    variables: ["name", "branch", "summary"],
  },
  {
    key: "on_agent_error",
    templateKey: "agent_error",
    label: "Agent error",
    description: "Sub-agent entered error state",
    defaultMode: "notify",
    variables: ["name", "branch"],
  },
  {
    key: "on_ci_passed",
    templateKey: "ci_passed",
    label: "CI passed",
    description: "PR checks passed — usually no action needed",
    defaultMode: "off",
    variables: ["pr_number", "title", "summary"],
    autoActionTemplateKey: undefined,
    autoActionBehavior: "Dispatch a reviewer when the PR has no review yet.",
  },
  {
    key: "on_ci_failed",
    templateKey: "ci_failed",
    label: "CI failed",
    description: "PR checks failed — action required",
    defaultMode: "notify",
    variables: ["pr_number", "title", "failed_details"],
    autoActionTemplateKey: "ci_failed_implementer",
    autoActionVariables: ["pr_number", "title", "branch", "failed_details"],
    autoActionBehavior: "Instruct the implementer to fix the failure.",
  },
  {
    key: "on_pr_created",
    templateKey: "pr_created",
    label: "PR created",
    description: "New pull request opened",
    defaultMode: "notify",
    variables: ["pr_number", "title", "branch"],
  },
  {
    key: "on_pr_comment",
    templateKey: "pr_comment",
    label: "Review feedback",
    description: "PR received review comments (changes requested)",
    defaultMode: "notify",
    variables: ["pr_number", "title", "comments_summary"],
    autoActionTemplateKey: "review_feedback_implementer",
    autoActionVariables: ["pr_number", "title", "branch", "comments_summary"],
    autoActionBehavior: "Instruct the implementer to address the feedback.",
  },
  {
    key: "on_rebase_conflict",
    templateKey: "rebase_conflict",
    label: "Rebase conflict",
    description: "Merge/rebase conflict detected",
    defaultMode: "notify",
    variables: ["branch", "error"],
  },
  {
    key: "on_pr_closed",
    templateKey: "pr_closed",
    label: "PR closed",
    description: "Pull request closed or merged",
    defaultMode: "notify",
    variables: ["pr_number", "title", "branch"],
  },
  {
    key: "on_guardrail_exceeded",
    templateKey: "guardrail_exceeded",
    label: "Guardrail exceeded",
    description: "CI retries, review loops, or failure limit exceeded",
    defaultMode: "notify",
    variables: ["guardrail", "branch", "count", "limit"],
  },
];

/**
 * Events whose handling can be AutoAction. The row for `on_ci_passed` also
 * supports AutoAction (dispatches a reviewer) even though it has no template.
 */
const AUTO_ACTION_EVENTS: ReadonlySet<NotifyEventDef["key"]> = new Set([
  "on_ci_failed",
  "on_pr_comment",
  "on_ci_passed",
]);

/** Orchestrator notification settings with per-event toggles and template editing */
export function NotifySettingsSection({
  orchestrator,
  setOrchestrator,
  orchProject,
  save,
}: {
  orchestrator: OrchestratorSettings;
  setOrchestrator: (v: OrchestratorSettings) => void;
  orchProject: string | undefined;
  save: ReturnType<typeof useSaveTracker>;
}) {
  const [expandedTemplate, setExpandedTemplate] = useState<string | null>(null);

  // Change the per-event handling mode (off / notify / auto_action) and persist
  const setHandling = (key: NotifyEventDef["key"], value: EventHandling) => {
    const updated = {
      ...orchestrator,
      notify: { ...orchestrator.notify, [key]: value },
    };
    setOrchestrator(updated);
    void save.track(
      () => api.updateOrchestratorSettings({ notify: { [key]: value } }, orchProject),
      { onError: () => setOrchestrator(orchestrator) },
    );
  };

  // Save a notify-mode template change (text-field commit; no rollback)
  const saveTemplate = (templateKey: NotifyEventDef["templateKey"], value: string) => {
    const templates: Record<string, string> = { [templateKey]: value };
    void save.track(() =>
      api.updateOrchestratorSettings(
        { notify: { templates: templates as Partial<NotifyTemplates> } },
        orchProject,
      ),
    );
  };

  // Save an auto-action template change (text-field commit; no rollback)
  const saveAutoActionTemplate = (templateKey: keyof AutoActionTemplates, value: string) => {
    const templates: Record<string, string> = { [templateKey]: value };
    void save.track(() =>
      api.updateOrchestratorSettings(
        {
          auto_action_templates: templates as Partial<AutoActionTemplates>,
        },
        orchProject,
      ),
    );
  };

  // Toggle one of the origin-aware filter booleans (#440)
  type OriginFilterKey =
    | "suppress_self"
    | "notify_on_human_action"
    | "notify_on_agent_action"
    | "notify_on_system_action";
  const setOriginFlag = (key: OriginFilterKey, value: boolean) => {
    const updated = {
      ...orchestrator,
      notify: { ...orchestrator.notify, [key]: value },
    };
    setOrchestrator(updated);
    void save.track(
      () => api.updateOrchestratorSettings({ notify: { [key]: value } }, orchProject),
      { onError: () => setOrchestrator(orchestrator) },
    );
  };

  return (
    <>
      <p className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider mt-1">
        Notifications
      </p>
      <p className="text-[10px] text-zinc-500 -mt-1 mb-1">
        Decide how tmai handles background events while the orchestrator is working.
      </p>
      <dl className="text-[10px] text-zinc-500 mb-2 space-y-1">
        <div className="flex gap-2">
          <dt className="w-[68px] shrink-0 text-zinc-400">Off</dt>
          <dd className="flex-1 text-zinc-500">
            Silent; only the task log records it. Good for events you don&apos;t want to see at all.
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-[68px] shrink-0 text-zinc-400">Notify</dt>
          <dd className="flex-1 text-zinc-500">
            The orchestrator gets a send_prompt. Good when you want to stay in the loop but decide
            yourself. Trade-off: every event interrupts the orchestrator.
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-[68px] shrink-0 text-zinc-400">Auto Action</dt>
          <dd className="flex-1 text-zinc-500">
            tmai handles it directly without asking — e.g. CI failed → instruct the implementer;
            Review feedback → instruct the implementer; CI passed (no review) → dispatch a reviewer.
            Trade-off: orchestrator only surfaces on guardrail trips (bounded retries, PR-age limit,
            etc.).
          </dd>
        </div>
      </dl>

      <div className="space-y-0.5">
        {NOTIFY_EVENTS.map((evt) => {
          const current = orchestrator.notify[evt.key] as EventHandling;
          const templateValue = orchestrator.notify.templates[evt.templateKey];
          const isExpanded = expandedTemplate === evt.key;
          const supportsAutoAction = AUTO_ACTION_EVENTS.has(evt.key);
          const autoActionTpl = evt.autoActionTemplateKey
            ? (orchestrator.auto_action_templates?.[evt.autoActionTemplateKey] ?? "")
            : "";
          const showNotifyTemplate = current === "notify" && isExpanded;
          const showAutoActionTemplate =
            current === "auto_action" && isExpanded && !!evt.autoActionTemplateKey;

          return (
            <div key={evt.key}>
              {/* Row: radio group + template toggle */}
              <div className="flex items-center justify-between gap-2 py-1">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-zinc-300">{evt.label}</span>
                    <span
                      className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-white/10 text-[9px] text-zinc-500 cursor-help select-none"
                      title={buildNotifyEventHelp({
                        label: evt.label,
                        defaultMode: evt.defaultMode,
                        autoActionBehavior: evt.autoActionBehavior,
                        hasTemplate: !!evt.autoActionTemplateKey,
                      })}
                      role="img"
                      aria-label={`Help: ${evt.label} — default mode and Auto Action support`}
                    >
                      ?
                    </span>
                  </div>
                  <p className="text-[10px] text-zinc-600 truncate">{evt.description}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {current !== "off" && (current === "notify" || evt.autoActionTemplateKey) && (
                    <button
                      type="button"
                      onClick={() => setExpandedTemplate(isExpanded ? null : evt.key)}
                      className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors px-1"
                      title="Edit prompt template"
                    >
                      {isExpanded ? "hide" : "template"}
                    </button>
                  )}
                  <HandlingRadioGroup
                    name={evt.key}
                    value={current}
                    onChange={(v) => setHandling(evt.key, v)}
                    supportsAutoAction={supportsAutoAction}
                  />
                </div>
              </div>

              {/* Expandable notify-mode template editor */}
              {showNotifyTemplate && (
                <div className="ml-2 mb-2">
                  <div className="relative">
                    <textarea
                      value={templateValue}
                      onChange={(e) => {
                        const updated = {
                          ...orchestrator,
                          notify: {
                            ...orchestrator.notify,
                            templates: {
                              ...orchestrator.notify.templates,
                              [evt.templateKey]: e.target.value,
                            },
                          },
                        };
                        setOrchestrator(updated);
                      }}
                      onBlur={() => saveTemplate(evt.templateKey, templateValue)}
                      rows={2}
                      placeholder={
                        orchestrator.notify.default_templates[evt.templateKey] ||
                        "Empty = use built-in default"
                      }
                      className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1 pr-7 text-[11px] text-zinc-300 placeholder-zinc-700 outline-none focus:border-cyan-500/30 resize-y font-mono"
                    />
                    {templateValue && (
                      <button
                        type="button"
                        onClick={() => {
                          const updated = {
                            ...orchestrator,
                            notify: {
                              ...orchestrator.notify,
                              templates: {
                                ...orchestrator.notify.templates,
                                [evt.templateKey]: "",
                              },
                            },
                          };
                          setOrchestrator(updated);
                          saveTemplate(evt.templateKey, "");
                        }}
                        className="absolute top-1.5 right-1.5 text-zinc-600 hover:text-zinc-300 transition-colors"
                        title="Reset to default template"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 16 16"
                          fill="currentColor"
                          className="w-3.5 h-3.5"
                          role="img"
                          aria-label="Reset to default"
                        >
                          <path
                            fillRule="evenodd"
                            d="M3.5 2a.5.5 0 0 0-.5.5v11a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5v-11a.5.5 0 0 0-.5-.5h-9ZM6.354 5.646a.5.5 0 1 0-.708.708L7.293 8l-1.647 1.646a.5.5 0 0 0 .708.708L8 8.707l1.646 1.647a.5.5 0 0 0 .708-.708L8.707 8l1.647-1.646a.5.5 0 1 0-.708-.708L8 7.293 6.354 5.646Z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </button>
                    )}
                  </div>
                  <p className="text-[10px] text-zinc-600 mt-0.5">
                    Variables: {evt.variables.map((v) => `{{${v}}}`).join(", ")}
                  </p>
                </div>
              )}

              {/* Expandable auto-action template editor */}
              {showAutoActionTemplate && evt.autoActionTemplateKey && (
                <AutoActionTemplateEditor
                  autoActionKey={evt.autoActionTemplateKey}
                  value={autoActionTpl}
                  onChange={(next) => {
                    const updated = {
                      ...orchestrator,
                      auto_action_templates: {
                        ...(orchestrator.auto_action_templates ?? {
                          ci_failed_implementer: "",
                          review_feedback_implementer: "",
                        }),
                        [evt.autoActionTemplateKey as string]: next,
                      },
                    };
                    setOrchestrator(updated);
                  }}
                  onSave={(next) =>
                    saveAutoActionTemplate(
                      evt.autoActionTemplateKey as keyof AutoActionTemplates,
                      next,
                    )
                  }
                  variables={evt.autoActionVariables ?? []}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* #440 Origin-aware filtering for ActionPerformed events */}
      <p className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider mt-4">Sources</p>
      <p className="text-[10px] text-zinc-600 -mt-1 mb-1">
        Choose which initiators of side-effect actions trigger a notification. Self-suppress hides
        echoes for actions you (an orchestrator) just performed.
      </p>
      <div className="space-y-0.5">
        <OriginToggleRow
          label="Skip my own actions"
          description="Suppress echoes when an orchestrator initiated the action"
          checked={orchestrator.notify.suppress_self}
          onChange={(v) => setOriginFlag("suppress_self", v)}
        />
        <OriginToggleRow
          label="Human actions"
          description="WebUI / TUI / CLI initiated actions (kill_agent, approve, …)"
          checked={orchestrator.notify.notify_on_human_action}
          onChange={(v) => setOriginFlag("notify_on_human_action", v)}
        />
        <OriginToggleRow
          label="Agent actions"
          description="Actions from MCP, sub-agents, AutoActionExecutor"
          checked={orchestrator.notify.notify_on_agent_action}
          onChange={(v) => setOriginFlag("notify_on_agent_action", v)}
        />
        <OriginToggleRow
          label="System actions"
          description="auto_cleanup, pr_monitor, and other tmai-internal subsystems"
          checked={orchestrator.notify.notify_on_system_action}
          onChange={(v) => setOriginFlag("notify_on_system_action", v)}
        />
      </div>
    </>
  );
}

/** One row of the Sources subsection — label/description + toggle. */
function OriginToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <div className="flex-1 min-w-0">
        <span className="text-xs text-zinc-300">{label}</span>
        <p className="text-[10px] text-zinc-600 truncate">{description}</p>
      </div>
      <button
        type="button"
        aria-pressed={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
          checked ? "bg-cyan-500/40" : "bg-white/10"
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 rounded-full transition-transform ${
            checked ? "translate-x-[18px] bg-cyan-400" : "translate-x-0.5 bg-zinc-500"
          }`}
        />
      </button>
    </div>
  );
}

/** Inline editor for an AutoAction template. */
function AutoActionTemplateEditor({
  autoActionKey: _autoActionKey,
  value,
  onChange,
  onSave,
  variables,
}: {
  autoActionKey: keyof AutoActionTemplates;
  value: string;
  onChange: (next: string) => void;
  onSave: (next: string) => void | Promise<void>;
  variables: string[];
}) {
  return (
    <div className="ml-2 mb-2">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => onSave(value)}
        rows={2}
        placeholder="Empty = use built-in default"
        className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1 pr-7 text-[11px] text-zinc-300 placeholder-zinc-700 outline-none focus:border-cyan-500/30 resize-y font-mono"
      />
      <p className="text-[10px] text-zinc-600 mt-0.5">
        Auto Action prompt — sent directly to the target worker. Variables:{" "}
        {variables.map((v) => `{{${v}}}`).join(", ")}
      </p>
    </div>
  );
}

/** Tri-state radio group for per-event handling. */
function HandlingRadioGroup({
  name,
  value,
  onChange,
  supportsAutoAction,
}: {
  name: string;
  value: EventHandling;
  onChange: (v: EventHandling) => void;
  supportsAutoAction: boolean;
}) {
  const options: {
    v: EventHandling;
    label: string;
    title: string;
  }[] = [
    {
      v: "off",
      label: "Off",
      title: "Silent — only the task log records it; orchestrator is not notified.",
    },
    {
      v: "notify",
      label: "Notify",
      title: "Forward to the orchestrator via send_prompt so you can decide what to do.",
    },
  ];
  if (supportsAutoAction) {
    options.push({
      v: "auto_action",
      label: "Auto",
      title:
        "tmai handles it directly (instructs the target worker or dispatches a reviewer). Orchestrator only surfaces on guardrail trips.",
    });
  }
  return (
    <div
      title={`Handling for ${name}`}
      className="inline-flex items-center rounded-md overflow-hidden border border-white/10"
    >
      {options.map((opt) => {
        const selected = value === opt.v;
        return (
          <button
            key={opt.v}
            type="button"
            aria-pressed={selected}
            title={opt.title}
            onClick={() => onChange(opt.v)}
            className={`text-[10px] px-1.5 py-0.5 transition-colors ${
              selected
                ? "bg-cyan-500/30 text-cyan-200"
                : "bg-transparent text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
