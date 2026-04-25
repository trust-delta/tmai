// Typed narrowing for SSE payloads from the tmai axum backend.
//
// `SSEHandlers.onEvent` in `lib/sse-provider.tsx` delivers `(name, unknown)`
// because EventSource is inherently untyped on the wire. This helper maps
// a named SSE event back to the generated `CoreEvent` discriminated union
// so consumers can narrow with exhaustive switch statements.
//
// Server emits each CoreEvent variant as a named SSE event with the
// PascalCase variant name; the payload on the wire is the variant's fields
// (flat, thanks to `#[serde(tag = "type")]`). We reconstruct the tagged
// shape here to match `CoreEvent`.
//
// Phase 1 transition: the new Entity-Update variants (AgentUpdate,
// DispatchUpdate, TeamUpdate, WorktreeUpdate, QueueUpdate, RuntimeUpdate)
// coexist with legacy signal variants (AgentStatusChanged, AgentsUpdated,
// etc.) — both shapes are in CoreEvent and accepted by asCoreEvent().

import type { CoreEvent } from "./generated/CoreEvent";

// All PascalCase discriminant values from CoreEvent.
type CoreEventTag = CoreEvent extends { type: infer T } ? T : never;

// Entity-Update variants introduced in Phase 1 (tmai-core@c40e8b8aa5).
// These carry a full snapshot payload and replace the legacy signal events
// for reactive state management. The sibling SSE/Bootstrap wiring sub-issue
// wires up the actual snapshot consumption.
const ENTITY_UPDATE_TAGS = [
  "AgentUpdate",
  "DispatchUpdate",
  "TeamUpdate",
  "WorktreeUpdate",
  "QueueUpdate",
  "RuntimeUpdate",
] as const;

type EntityUpdateTag = (typeof ENTITY_UPDATE_TAGS)[number];

export type EntityUpdateEvent = Extract<CoreEvent, { type: EntityUpdateTag }>;

export function isEntityUpdateEvent(event: CoreEvent): event is EntityUpdateEvent {
  return (ENTITY_UPDATE_TAGS as readonly string[]).includes(event.type);
}

export function asCoreEvent(eventName: string, data: unknown): CoreEvent | null {
  if (data === null || typeof data !== "object") {
    return null;
  }
  // The wire shape already has `type` when the server routes via SSE's
  // `event:` field, but some paths omit it and rely on the event name
  // exclusively. Normalize by preferring the explicit tag when present.
  const maybeTagged = data as { type?: string };
  const tag = (maybeTagged.type ?? eventName) as CoreEventTag;
  return { ...(data as object), type: tag } as CoreEvent;
}
