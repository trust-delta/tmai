import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef } from "react";
import { type AgentSnapshot, subscribeSSE } from "./api";

// Handlers a subscriber can register with the shared SSE connection.
interface SSEHandlers {
  onAgents?: (agents: AgentSnapshot[]) => void;
  onEvent?: (eventName: string, data: unknown) => void;
}

interface SSEContextValue {
  subscribe: (handlers: SSEHandlers) => () => void;
}

const SSEContext = createContext<SSEContextValue | null>(null);

// Provider that opens a single EventSource connection and fans out events
// to every registered subscriber. Replaces the pattern where each hook/
// component called subscribeSSE directly, which created N parallel SSE
// connections and caused N× fetch/render amplification (observed in the
// 2026-04-12 cold-start flood investigation).
export function SSEProvider({ children }: { children: ReactNode }) {
  const subscribersRef = useRef(new Set<SSEHandlers>());

  useEffect(() => {
    const { unlisten } = subscribeSSE({
      onAgents: (agents) => {
        for (const sub of subscribersRef.current) {
          sub.onAgents?.(agents);
        }
      },
      onEvent: (eventName, data) => {
        for (const sub of subscribersRef.current) {
          sub.onEvent?.(eventName, data);
        }
      },
    });
    return unlisten;
  }, []);

  const subscribe = useCallback((handlers: SSEHandlers) => {
    subscribersRef.current.add(handlers);
    return () => {
      subscribersRef.current.delete(handlers);
    };
  }, []);

  return <SSEContext.Provider value={{ subscribe }}>{children}</SSEContext.Provider>;
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
    };
    return ctx.subscribe(stable);
  }, [ctx]);
}
