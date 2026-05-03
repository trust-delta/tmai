import type { useSaveTracker } from "@/hooks/useSaveTracker";
import { api, type OrchestratorSettings } from "@/lib/api";

/** Guardrails settings — limits to prevent infinite loops */
export function GuardrailsSection({
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
  const guardrailFields: {
    key: keyof OrchestratorSettings["guardrails"];
    label: string;
    description: string;
  }[] = [
    {
      key: "max_ci_retries",
      label: "Max CI retries",
      description: "CI fix attempts per PR before escalation",
    },
    {
      key: "max_review_loops",
      label: "Max review loops",
      description: "Review→fix cycles per PR before escalation",
    },
    {
      key: "escalate_to_human_after",
      label: "Escalate after failures",
      description: "Consecutive failures before notifying human",
    },
  ];

  const updateField = (key: keyof OrchestratorSettings["guardrails"], value: number) => {
    if (value < 1) return;
    const updated = {
      ...orchestrator,
      guardrails: { ...orchestrator.guardrails, [key]: value },
    };
    setOrchestrator(updated);
    void save.track(() =>
      api.updateOrchestratorSettings({ guardrails: { [key]: value } }, orchProject),
    );
  };

  return (
    <>
      <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mt-4 mb-2">
        Guardrails
      </h4>
      <div className="space-y-2">
        {guardrailFields.map((field) => (
          <div key={field.key} className="flex items-center justify-between gap-3">
            <div className="flex-1 min-w-0">
              <span className="text-xs text-zinc-300">{field.label}</span>
              <p className="text-[10px] text-zinc-600 leading-tight">{field.description}</p>
            </div>
            <input
              type="number"
              min={1}
              value={orchestrator.guardrails[field.key]}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                if (!Number.isNaN(val)) {
                  save.clearError();
                  setOrchestrator({
                    ...orchestrator,
                    guardrails: { ...orchestrator.guardrails, [field.key]: val },
                  });
                }
              }}
              onBlur={(e) => {
                const val = parseInt(e.target.value, 10);
                if (!Number.isNaN(val) && val >= 1) {
                  updateField(field.key, val);
                }
              }}
              className="w-16 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-zinc-200 text-center outline-none focus:border-cyan-500/30"
            />
          </div>
        ))}
      </div>
    </>
  );
}
