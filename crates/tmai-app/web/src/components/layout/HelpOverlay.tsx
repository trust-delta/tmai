import { X } from "lucide-react";

interface HelpOverlayProps {
  isOpen: boolean;
  onClose: () => void;
}

export function HelpOverlay({ isOpen, onClose }: HelpOverlayProps) {
  if (!isOpen) return null;

  const shortcuts = [
    {
      category: "Navigation",
      items: [
        { key: "?", description: "Toggle this help menu" },
        { key: "[", description: "Previous project" },
        { key: "]", description: "Next project" },
        { key: "/", description: "Focus project search" },
      ],
    },
    {
      category: "Agent Control",
      items: [
        { key: "a", description: "Approve selected agent" },
        { key: "k", description: "Kill selected agent" },
      ],
    },
    {
      category: "Settings",
      items: [
        { key: "s", description: "Toggle settings panel" },
        { key: "Ctrl+Shift+S", description: "Toggle security scan" },
      ],
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="glass-deep relative w-full max-w-2xl rounded-2xl border border-white/10 shadow-2xl animate-scale-in">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <h2 className="text-lg font-semibold text-zinc-100">
            Keyboard Shortcuts
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-2 transition-colors hover:bg-white/10"
          >
            <X size={20} className="text-zinc-400" />
          </button>
        </div>

        {/* Content */}
        <div className="max-h-[60vh] overflow-y-auto px-6 py-4">
          <div className="grid grid-cols-2 gap-8">
            {shortcuts.map((section) => (
              <div key={section.category}>
                <h3 className="mb-3 text-sm font-semibold uppercase text-zinc-500">
                  {section.category}
                </h3>
                <div className="space-y-2">
                  {section.items.map((item) => (
                    <div key={item.key} className="flex items-start gap-3">
                      <kbd className="flex-shrink-0 rounded-lg border border-white/10 bg-white/[0.05] px-2.5 py-1 text-xs font-mono font-semibold text-cyan-400">
                        {item.key}
                      </kbd>
                      <p className="text-sm text-zinc-400">
                        {item.description}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-white/10 px-6 py-3 text-center text-xs text-zinc-600">
          Press <kbd className="rounded border border-white/10 bg-white/[0.05] px-1">ESC</kbd> or click the X to close
        </div>
      </div>
    </div>
  );
}
