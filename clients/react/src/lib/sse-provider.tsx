import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { BootstrapRequiredEvent } from "@/types/generated/BootstrapRequiredEvent";
import type { EntityUpdateEnvelope } from "@/types/generated/EntityUpdateEnvelope";
import type { QueueAgentEntry } from "@/types/generated/QueueAgentEntry";
import type { AgentSnapshot, BootstrapPayload, WorktreeSnapshot } from "./api";
import { api, subscribeSSE } from "./api";

// Handlers a subscriber can register with the shared SSE connection.
export interface SSEHandlers {
  onAgents?: (agents: AgentSnapshot[]) => void;
  onEvent?: (eventName: string, data: unknown) => void;
  onEntityUpdate?: (envelope: EntityUpdateEnvelope) => void;
  /// Fires after SSE reconnects (not on the first open). Subscribers
  /// that rely on event-driven state should refetch their snapshot
  /// here, since EventSource doesn't replay missed named events.
  onReconnect?: () => void;
}

// Normalized entity cache — seeded by bootstrap, kept live via EntityUpdate events.
export interface EntityCache {
  agents: AgentSnapshot[];
  worktrees: WorktreeSnapshot[];
  // Per-agent queue entries (one entry per agent that has queued prompts)
  queueEntries: QueueAgentEntry[];
  loading: boolean;
}

interface SSEContextValue {
  subscribe: (handlers: SSEHandlers) => () => void;
  cache: EntityCache;
  // Trigger a full re-bootstrap (e.g., on Tauri agent-updated events)
  refreshCache: () => Promise<void>;
}

const SSEContext = createContext<SSEContextValue | null>(null);

// Provider that owns a single EventSource connection, fans out events to
// subscribers, and maintains a normalized entity cache seeded by bootstrap.
//
// Replaces the pattern where each hook/component called subscribeSSE directly,
// which created N parallel SSE connections (observed in the 2026-04-12 cold-start
// flood investigation). Also eliminates per-hook polling by maintaining a shared
// cache that hooks read reactively.
export function SSEProvider({ children }: { children: ReactNode }) {
  const subscribersRef = useRef(new Set<SSEHandlers>());

  // Entity maps — O(1) upsert/remove, id is the stable entity key
  const agentMapRef = useRef<Map<string, AgentSnapshot>>(new Map());
  const worktreeMapRef = useRef<Map<string, WorktreeSnapshot>>(new Map());
  // Queue map: keyed by agent_id (entity id == QueueAgentEntry.agent_id)
  const queueMapRef = useRef<Map<string, QueueAgentEntry>>(new Map());

  // Reactive state derived from the maps — triggers re-renders in consumers
  const [agents, setAgents] = useState<AgentSnapshot[]>([]);
  const [worktrees, setWorktrees] = useState<WorktreeSnapshot[]>([]);
  const [queueEntries, setQueueEntries] = useState<QueueAgentEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // lastSeq drives ?since=<seq> on SSE reconnect to replay missed entity events
  const lastSeqRef = useRef<bigint | undefined>(undefined);
  // Increment to force SSE effect re-run (e.g., after BootstrapRequired recovery)
  const [reconnectKey, setReconnectKey] = useState(0);

  const refreshCache = useCallback(async (): Promise<void> => {
    try {
      const payload: BootstrapPayload = await api.bootstrap();

      agentMapRef.current = new Map(payload.agents.map((a) => [a.id, a]));
      worktreeMapRef.current = new Map(payload.worktrees.map((w) => [w.name, w]));
      const qMap = new Map<string, QueueAgentEntry>();
      for (const entry of payload.queue.entries) {
        qMap.set(entry.agent_id, entry);
      }
      queueMapRef.current = qMap;

      setAgents([...agentMapRef.current.values()]);
      setWorktrees([...worktreeMapRef.current.values()]);
      setQueueEntries([...queueMapRef.current.values()]);
      setLoading(false);
    } catch {
      // Server may not be ready yet during startup; loading stays true
    }
  }, []);

  // Seed cache on mount
  useEffect(() => {
    void refreshCache();
  }, [refreshCache]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reconnectKey is intentional — incrementing it forces a new SSE connection after BootstrapRequired recovery
  useEffect(() => {
    const { unlisten } = subscribeSSE(
      {
        onAgents: (agentList) => {
          // Legacy "agents" full-list event — update map and state
          agentMapRef.current = new Map(agentList.map((a) => [a.id, a]));
          setAgents([...agentMapRef.current.values()]);
          setLoading(false);
          for (const sub of subscribersRef.current) {
            sub.onAgents?.(agentList);
          }
        },
        onEvent: (eventName, data) => {
          for (const sub of subscribersRef.current) {
            sub.onEvent?.(eventName, data);
          }
        },
        onEntityUpdate: (envelope) => {
          const { entity, id, change, snapshot } = envelope;

          // Track the latest seq for ?since= reconnect
          if (lastSeqRef.current === undefined || envelope.seq > lastSeqRef.current) {
            lastSeqRef.current = envelope.seq;
          }

          if (entity === "Agent") {
            if (change === "Removed") {
              agentMapRef.current.delete(id);
            } else if (snapshot != null) {
              agentMapRef.current.set(id, snapshot as AgentSnapshot);
            }
            setAgents([...agentMapRef.current.values()]);
          } else if (entity === "Worktree") {
            if (change === "Removed") {
              worktreeMapRef.current.delete(id);
            } else if (snapshot != null) {
              worktreeMapRef.current.set(id, snapshot as WorktreeSnapshot);
            }
            setWorktrees([...worktreeMapRef.current.values()]);
          } else if (entity === "Queue") {
            if (change === "Removed") {
              queueMapRef.current.delete(id);
            } else if (snapshot != null) {
              queueMapRef.current.set(id, snapshot as QueueAgentEntry);
            }
            setQueueEntries([...queueMapRef.current.values()]);
          }

          for (const sub of subscribersRef.current) {
            sub.onEntityUpdate?.(envelope);
          }
        },
        onBootstrapRequired: (_event: BootstrapRequiredEvent) => {
          // Buffer overflowed: re-seed from REST then reconnect SSE without ?since=
          // so the server sends a fresh stream from the current position.
          lastSeqRef.current = undefined;
          void refreshCache().then(() => setReconnectKey((k) => k + 1));
        },
        onReconnect: () => {
          for (const sub of subscribersRef.current) {
            sub.onReconnect?.();
          }
        },
      },
      lastSeqRef.current,
    );
    return unlisten;
  }, [refreshCache, reconnectKey]);

  const subscribe = useCallback((handlers: SSEHandlers) => {
    subscribersRef.current.add(handlers);
    return () => {
      subscribersRef.current.delete(handlers);
    };
  }, []);

  const cache: EntityCache = { agents, worktrees, queueEntries, loading };

  return (
    <SSEContext.Provider value={{ subscribe, cache, refreshCache }}>{children}</SSEContext.Provider>
  );
}

// Subscribe to the shared SSE connection. Handlers are held via ref so
// callers don't have to memoize; the subscription itself only reinstalls
// when the provider mounts/unmounts.
export function useSSE(handlers: SSEHandlers): void {
  const ctx = useContext(SSEContext);
  if (!ctx) {
    throw new Error("useSSE must be used inside <SSEProvider>");
  }
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const stable: SSEHandlers = {
      onAgents: (agents) => handlersRef.current.onAgents?.(agents),
      onEvent: (eventName, data) => handlersRef.current.onEvent?.(eventName, data),
      onEntityUpdate: (envelope) => handlersRef.current.onEntityUpdate?.(envelope),
      onReconnect: () => handlersRef.current.onReconnect?.(),
    };
    return ctx.subscribe(stable);
  }, [ctx]);
}

// Access the full SSE context (cache + refreshCache + subscribe).
// Use this when a hook needs to read from the normalized entity cache.
export function useSSEContext(): SSEContextValue {
  const ctx = useContext(SSEContext);
  if (!ctx) {
    throw new Error("useSSEContext must be used inside <SSEProvider>");
  }
  return ctx;
}
