interface QueueBadgeProps {
  count: number;
  onClick: () => void;
  icon?: string;
  title?: string;
}

// Generic badge button for any pending-item queue.
// Renders nothing when count is 0 — callers need no guard.
// Reusable for send_prompt (#3) and notification mixing (#9).
export function QueueBadge({ count, onClick, icon = "✉", title }: QueueBadgeProps) {
  if (count === 0) return null;
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="rounded px-1.5 py-0.5 text-[10px] transition-colors bg-warning/20 text-warning hover:bg-warning/30"
      title={title ?? `${count} item${count !== 1 ? "s" : ""} queued — click to view`}
    >
      {icon} {count}
    </button>
  );
}
