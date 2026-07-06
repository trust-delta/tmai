// Browser notification when agents transition from Processing to Idle/Stopped.
//
// Delay tiers by `detection_source` (snake_case wire enum, see
// `@/types/generated/DetectionSource`):
// - `http_hook`: stop hook is definitive, notify immediately
// - `web_socket`: reliable channel, short capped threshold is safe
// - `pty_server`: terminal-observation detection can flicker, full threshold
//
// Uses the Notification API so notifications appear even when the tab is in the background.

import { useCallback, useEffect, useRef } from "react";
import { type AgentSnapshot, type DetectionSource, isAiAgent } from "@/lib/api";

export interface IdleNotificationConfig {
  enabled: boolean;
  thresholdSecs: number;
}

interface AgentIdleState {
  /** When this agent first became idle (ms timestamp) */
  idleSince: number;
  /** Timer ID for delayed notification */
  timerId: ReturnType<typeof setTimeout> | null;
  /** Whether we already notified for this idle period */
  notified: boolean;
}

/// Determine the notification delay based on detection source.
///
/// The wire enum is snake_case (`@/types/generated/DetectionSource`). The
/// retired PascalCase hand-mirror meant none of these cases ever matched at
/// runtime, so every agent silently fell through to the full-threshold
/// default — the hook-immediate (0ms) and short-threshold tiers never fired.
function getDelay(source: DetectionSource, thresholdSecs: number): number {
  switch (source) {
    // Hook-based: stop event is definitive — highest fidelity, notify at once.
    case "http_hook":
      return 0;
    // WebSocket channel: structured and reliable, so a short capped threshold
    // debounces transient states without noticeable lag.
    case "web_socket":
      return Math.min(thresholdSecs * 1000, 2000);
    // `pty_server` (and any future source): terminal-observation detection can
    // flicker, so wait the full threshold before notifying.
    default:
      return thresholdSecs * 1000;
  }
}

/// Request browser notification permission if not yet granted
function ensurePermission(): Promise<boolean> {
  if (!("Notification" in window)) return Promise.resolve(false);
  if (Notification.permission === "granted") return Promise.resolve(true);
  if (Notification.permission === "denied") return Promise.resolve(false);
  return Notification.requestPermission().then((p) => p === "granted");
}

/// Send a browser notification for an idle agent.
/// lastMessage, when provided, is surfaced in the notification body so the
/// notification surface is the authoritative display — never the conversation input.
function sendNotification(agent: AgentSnapshot, lastMessage?: string | null) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;

  const title = `${agent.display_name} is now idle`;
  const projectName = agent.cwd.split("/").filter(Boolean).pop() || agent.cwd;
  const body = lastMessage
    ? lastMessage.slice(0, 200)
    : `Agent in ${projectName} has finished processing.`;

  new Notification(title, {
    body,
    tag: `tmai-idle-${agent.id}`,
    // Reuse same tag to avoid duplicate notifications for the same agent
  });
}

// Hook: watch the agent list for transitions into a user-blocked
// attention state and fire browser notifications.
//
// Decision tmai-core@2026-05-09 Phase 4: the wire `attention` is
// `"started" | "halted" | "completed"` + `null`. We notify on
// transitions into `Halted` (permission prompt) or `Completed` (turn
// done) because those are the states the user typically waits to
// react to. `Started` is suppressed — the user just spawned the agent,
// they don't need to be told it's started.
export function useIdleNotification(agents: AgentSnapshot[], config: IdleNotificationConfig) {
  // Track per-agent idle state
  const stateMap = useRef(new Map<string, AgentIdleState>());
  // Track previous `attention` value per agent for transition detection.
  const prevAttentionMap = useRef(new Map<string, AgentSnapshot["attention"]>());

  // Request permission when enabled
  useEffect(() => {
    if (config.enabled) {
      ensurePermission();
    }
  }, [config.enabled]);

  // Main effect: compare old vs new status for each agent
  useEffect(() => {
    if (!config.enabled) {
      // Clear all pending timers
      for (const state of stateMap.current.values()) {
        if (state.timerId) clearTimeout(state.timerId);
      }
      stateMap.current.clear();
      prevAttentionMap.current.clear();
      return;
    }

    const currentIds = new Set<string>();

    for (const agent of agents) {
      // Only track AI agents
      if (!isAiAgent(agent.agent_type)) continue;

      currentIds.add(agent.id);
      const attention = agent.attention ?? null;
      const prevAttention = prevAttentionMap.current.get(agent.id);
      prevAttentionMap.current.set(agent.id, attention);

      const idleState = stateMap.current.get(agent.id);

      // Notification-worthy states: `halted` and `completed`. `started`
      // is suppressed — the user just clicked spawn, no surprise.
      // First observation (`prevAttention === undefined`) does NOT count
      // as a transition: a freshly-loaded tab should not shower stale
      // notifications for long-pending agents.
      const isNotifyState = attention === "halted" || attention === "completed";
      const wasNotifyState = prevAttention === "halted" || prevAttention === "completed";
      const justBecameNeedsHuman = prevAttention !== undefined && !wasNotifyState && isNotifyState;

      if (isNotifyState) {
        if (justBecameNeedsHuman && !idleState?.notified) {
          const delay = getDelay(agent.detection_source, config.thresholdSecs);

          // Clear any existing timer
          if (idleState?.timerId) clearTimeout(idleState.timerId);

          if (delay === 0) {
            // Immediate notification (hook-based)
            sendNotification(agent);
            stateMap.current.set(agent.id, {
              idleSince: Date.now(),
              timerId: null,
              notified: true,
            });
          } else {
            // Delayed notification with threshold
            const timerId = setTimeout(() => {
              const currentState = stateMap.current.get(agent.id);
              if (currentState && !currentState.notified) {
                sendNotification(agent);
                currentState.notified = true;
              }
            }, delay);
            stateMap.current.set(agent.id, {
              idleSince: Date.now(),
              timerId,
              notified: false,
            });
          }
        }
        // If already needs-human and already notified (or no transition), do nothing
      } else {
        // Agent is processing or in another state — reset idle tracking
        if (idleState) {
          if (idleState.timerId) clearTimeout(idleState.timerId);
          stateMap.current.delete(agent.id);
        }
      }
    }

    // Clean up agents that disappeared
    for (const [id, state] of stateMap.current.entries()) {
      if (!currentIds.has(id)) {
        if (state.timerId) clearTimeout(state.timerId);
        stateMap.current.delete(id);
        prevAttentionMap.current.delete(id);
      }
    }
  }, [agents, config.enabled, config.thresholdSecs]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      for (const state of stateMap.current.values()) {
        if (state.timerId) clearTimeout(state.timerId);
      }
    };
  }, []);

  // Handle agent_stopped SSE event — immediate notification for hook-detected stops
  const handleAgentStopped = useCallback(
    (data: { target: string; cwd: string; last_assistant_message?: string }) => {
      if (!config.enabled) return;

      const agent = agents.find((a) => a.target === data.target);
      if (!agent || !isAiAgent(agent.agent_type)) return;

      // AgentStopped is from hook — definitive, notify immediately
      const idleState = stateMap.current.get(agent.id);
      if (idleState?.notified) return; // Already notified via status transition

      // Cancel any pending timer
      if (idleState?.timerId) clearTimeout(idleState.timerId);

      sendNotification(agent, data.last_assistant_message);
      stateMap.current.set(agent.id, {
        idleSince: Date.now(),
        timerId: null,
        notified: true,
      });
    },
    [agents, config.enabled],
  );

  return { handleAgentStopped };
}
