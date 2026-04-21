import type { EventHandling } from "@/lib/api";

export interface NotifyEventHelpInput {
  label: string;
  defaultMode: EventHandling;
  autoActionBehavior?: string;
  hasTemplate?: boolean;
}

const MODE_LABELS: Record<EventHandling, string> = {
  off: "Off (silent; task log only)",
  notify: "Notify (forward to orchestrator)",
  auto_action: "Auto Action (tmai handles directly)",
};

export function formatModeLabel(mode: EventHandling): string {
  return MODE_LABELS[mode];
}

export function buildNotifyEventHelp(evt: NotifyEventHelpInput): string {
  const lines: string[] = [evt.label, "", `Default: ${MODE_LABELS[evt.defaultMode]}`];

  if (evt.autoActionBehavior) {
    lines.push("", `Auto Action: ${evt.autoActionBehavior}`);
    if (evt.hasTemplate) {
      lines.push(`Select Auto and click "template" to customize the prompt.`);
    }
  } else {
    lines.push("", "Auto Action: not supported (Notify-only event).");
  }

  return lines.join("\n");
}
