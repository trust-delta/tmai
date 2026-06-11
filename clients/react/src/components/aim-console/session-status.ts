// Shared `attention` → status-dot mapping for the aim-console's session
// surfaces (the stab dots and the shead dot use the same language).
//
// Mirrors the existing console's flat `attention` enum reading
// (tmai-core@2026-05-09 Phase 4): `halted` → at a permission prompt,
// `started` / `completed` → waiting on the operator, `null` → running.

import type { AgentSnapshot } from "@/lib/api";

export function statusClass(attention: AgentSnapshot["attention"]): string {
  if (attention === "halted") return "halt";
  if (attention === "started" || attention === "completed") return "wait";
  return "run";
}

export function statusWord(attention: AgentSnapshot["attention"]): string {
  if (attention === "halted") return "Halted";
  if (attention === "completed") return "Done";
  if (attention === "started") return "Started";
  return "Active";
}
