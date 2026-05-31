// Shared "‹ Inventory" back affordance for the three R₂ viewers.
//
// Focus mode (spine `2026-05-29-c-and-r-as-the-development-substrate`): a
// viewer rides the R panel's single column IN PLACE OF the R₁ inventory,
// rather than as an additive column. So the viewer's close is not a column
// dismiss — it REVEALS the inventory again. This button reads as that
// return ("‹ Inventory"), not an ambiguous ×. It is still wired to the
// viewer's `onClose`, which clears the focus (App's clearPr / clearRecord
// / clearIssue) and so swaps the column back to the inventory body.
//
// Plain styling only (`text-muted-foreground` / `text-foreground`) — the
// viewers' negative-space rule (no severity tint on chrome) applies here
// too.

export function InventoryBackButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      title="Back to inventory"
      aria-label="Back to inventory"
      className="-ml-1 mb-1.5 flex items-center gap-0.5 rounded px-1 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-surface-strong hover:text-foreground"
    >
      <span aria-hidden="true">‹</span> Inventory
    </button>
  );
}
