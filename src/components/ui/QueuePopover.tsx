import { useEffect, useRef } from "react";

interface QueuePopoverProps<T extends { id: string }> {
  items: T[];
  renderItem: (item: T) => React.ReactNode;
  isOpen: boolean;
  onClose: () => void;
  onCancel: (id: string) => void;
  title?: string;
}

// Generic popover listing pending queue items with per-item cancel.
// Positions itself above its nearest relative-positioned ancestor.
// Closes on outside click. Reusable for send_prompt (#3) and #9.
export function QueuePopover<T extends { id: string }>({
  items,
  renderItem,
  isOpen,
  onClose,
  onCancel,
  title = "Queued items",
}: QueuePopoverProps<T>) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    function handleMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [isOpen, onClose]);

  if (!isOpen || items.length === 0) return null;

  return (
    <div
      ref={ref}
      className="absolute bottom-full left-0 z-50 mb-1 w-80 rounded-lg border border-white/10 bg-[#1a1a1a] shadow-xl"
    >
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <span className="text-[11px] font-medium text-zinc-300">{title}</span>
        <button
          type="button"
          onClick={onClose}
          className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
          aria-label="Close"
        >
          ✕
        </button>
      </div>
      <ul className="max-h-60 divide-y divide-white/5 overflow-y-auto">
        {items.map((item) => (
          <li key={item.id} className="flex items-start gap-2 px-3 py-2">
            <div className="min-w-0 flex-1">{renderItem(item)}</div>
            <button
              type="button"
              onClick={() => onCancel(item.id)}
              className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-red-400 transition-colors hover:bg-red-500/20"
              aria-label="Cancel queued prompt"
            >
              Cancel
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
