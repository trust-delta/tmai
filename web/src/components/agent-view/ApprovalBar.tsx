import { useState } from "react";
import {
  approveAgent,
  selectChoice,
  submitSelection,
  sendKey,
} from "../../api/client";
import type { Agent, InteractionMode } from "../../types/agent";

interface ApprovalBarProps {
  agent: Agent;
}

/// Extract choices and multi_select flag from InteractionMode
function parseInteraction(interaction: InteractionMode | null): {
  choices: string[];
  multiSelect: boolean;
} {
  if (!interaction) return { choices: [], multiSelect: false };
  if ("SingleSelect" in interaction) {
    return { choices: interaction.SingleSelect.choices, multiSelect: false };
  }
  return { choices: interaction.MultiSelect.choices, multiSelect: true };
}

export function ApprovalBar({ agent }: ApprovalBarProps) {
  const [sending, setSending] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  if (agent.status.type !== "awaiting_approval") return null;

  const { approval_type, details, interaction } = agent.status;
  const { choices, multiSelect } = parseInteraction(interaction);

  async function handleApprove() {
    setSending(true);
    try {
      await approveAgent(agent.id);
    } catch (err) {
      console.error("Approve failed:", err);
    } finally {
      setSending(false);
    }
  }

  async function handleChoice(idx: number) {
    if (multiSelect) {
      // Toggle selection
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(idx)) next.delete(idx);
        else next.add(idx);
        return next;
      });
      return;
    }
    setSending(true);
    try {
      await selectChoice(agent.id, idx);
    } catch (err) {
      console.error("Select failed:", err);
    } finally {
      setSending(false);
    }
  }

  async function handleSubmitSelection() {
    setSending(true);
    try {
      await submitSelection(agent.id, Array.from(selected));
    } catch (err) {
      console.error("Submit failed:", err);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="rounded-lg border border-yellow-300 bg-yellow-50 p-3 dark:border-yellow-800 dark:bg-yellow-950/30">
      {/* Details */}
      <div className="mb-2 text-sm text-yellow-800 dark:text-yellow-200">
        <span className="mr-2 font-semibold">[{approval_type}]</span>
        {details}
      </div>

      {/* Choices or approve button */}
      {choices.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {choices.map((choice, idx) => (
            <button
              key={idx}
              onClick={() => handleChoice(idx)}
              disabled={sending}
              className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                selected.has(idx)
                  ? "border-blue-500 bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200"
                  : "border-neutral-300 hover:border-neutral-400 hover:bg-neutral-100 dark:border-neutral-600 dark:hover:bg-neutral-800"
              } disabled:opacity-40`}
            >
              {choice}
            </button>
          ))}
          {multiSelect && (
            <button
              onClick={handleSubmitSelection}
              disabled={sending || selected.size === 0}
              className="rounded-md bg-green-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-600 disabled:opacity-40"
            >
              Submit
            </button>
          )}
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            onClick={handleApprove}
            disabled={sending}
            className="rounded-md bg-green-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-600 disabled:opacity-40"
          >
            Approve
          </button>
          <button
            onClick={async () => {
              setSending(true);
              try {
                await sendKey(agent.id, "Escape");
              } catch (e) {
                console.error("Reject failed:", e);
              } finally {
                setSending(false);
              }
            }}
            disabled={sending}
            className="rounded-md border border-red-700 px-4 py-1.5 text-sm text-red-700 hover:bg-red-100 disabled:opacity-40 dark:text-red-400 dark:hover:bg-red-900/30"
          >
            Reject
          </button>
        </div>
      )}
    </div>
  );
}
