import { statusLabel, statusColor } from "../../lib/formatStatus";
import type { StatusInfo } from "../../types/agent";

interface StatusBadgeProps {
  status: StatusInfo;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const color = statusColor(status);
  const label = statusLabel(status);

  const bgMap: Record<string, string> = {
    idle: "bg-green-100 dark:bg-green-900/30",
    processing: "bg-blue-100 dark:bg-blue-900/30",
    awaiting_approval: "bg-yellow-100 dark:bg-yellow-900/30",
    error: "bg-red-100 dark:bg-red-900/30",
    offline: "bg-neutral-100 dark:bg-neutral-800/30",
    unknown: "bg-neutral-100 dark:bg-neutral-800/30",
  };

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${color} ${bgMap[status.type] ?? ""}`}
    >
      <span className="text-[8px]">●</span>
      {label}
    </span>
  );
}
