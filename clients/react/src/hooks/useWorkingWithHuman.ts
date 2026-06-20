// Polling hook for the unit's `◐ Working with this human` view.
//
// Mirrors `useDecisions` / `useCalibration`: 60s poll, parked when `unit`
// is null, generation guard against in-flight stamping. The memory
// directory + `MEMORY.md` change on human timescales (operators editing
// memory entries occasionally); polling is fine. SSE follow-up
// (`CoreEvent::MemoryChanged`) would be the natural next step.

import { api, type WorkingWithHumanResponse } from "@/lib/api";
import { usePolledResource } from "./usePolledResource";

const POLL_INTERVAL_MS = 60_000;

export interface UseWorkingWithHumanResult {
  data: WorkingWithHumanResponse | null;
  loading: boolean;
  error: Error | null;
}

export function useWorkingWithHuman(unit: string | null): UseWorkingWithHumanResult {
  // Shared poll resource: the generation guard drops a stale-unit response
  // AND a response that resolves after unmount. See usePolledResource.
  return usePolledResource(unit, () => api.workingWithHuman(unit as string), {
    intervalMs: POLL_INTERVAL_MS,
  });
}
