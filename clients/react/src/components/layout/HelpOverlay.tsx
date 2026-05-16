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
        { key: "\\", description: "Toggle split view" },
        { key: "Ctrl+B", description: "Toggle sidebar" },
        { key: "Ctrl+.", description: "Toggle action panel" },
        { key: "Ctrl+[", description: "Previous project" },
        { key: "Ctrl+]", description: "Next project" },
      ],
    },
    {
      category: "Agent Control",
      items: [{ key: "Ctrl+Enter", description: "Approve selected agent" }],
    },
    {
      category: "Settings",
      items: [{ key: "Ctrl+,", description: "Toggle settings panel" }],
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background backdrop-blur-sm">
      <div className="glass-deep relative w-full max-w-2xl rounded-2xl border border-hairline-strong shadow-2xl animate-scale-in">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-hairline-strong px-6 py-4">
          <h2 className="text-lg font-semibold text-foreground">Keyboard Shortcuts</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 transition-colors hover:bg-surface-strong"
          >
            <X size={20} className="text-muted-foreground" />
          </button>
        </div>

        {/* Content */}
        <div className="max-h-[60vh] overflow-y-auto px-6 py-4">
          <div className="grid grid-cols-2 gap-8">
            {shortcuts.map((section) => (
              <div key={section.category}>
                <h3 className="mb-3 text-sm font-semibold uppercase text-muted-foreground">
                  {section.category}
                </h3>
                <div className="space-y-2">
                  {section.items.map((item) => (
                    <div key={item.key} className="flex items-start gap-3">
                      <kbd className="flex-shrink-0 rounded-lg border border-hairline-strong bg-surface px-2.5 py-1 text-xs font-mono font-semibold text-primary">
                        {item.key}
                      </kbd>
                      <p className="text-sm text-muted-foreground">{item.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-hairline-strong px-6 py-3 text-center text-xs text-subtle-foreground">
          Press <kbd className="rounded border border-hairline-strong bg-surface px-1">ESC</kbd> or
          click the X to close
        </div>
      </div>
    </div>
  );
}
