// Browser notification when agents transition from Processing to Idle/Stopped.
//
// - Hook-based detection (HttpHook): stop event is definitive, notify immediately
// - IPC/WebSocket detection: reliable, short threshold is safe
// - capture-pane detection: subject to flicker, full threshold required
//
// Uses the Notification API so notifications appear even when the tab is in the background.

import { useCallback, useEffect, useRef } from "react";
import { type AgentSnapshot, type DetectionSource, isAiAgent, statusName } from "@/lib/api";

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

/// Determine the notification delay based on detection source
function getDelay(source: DetectionSource, thresholdSecs: number): number {
  switch (source) {
    // Hook-based: stop event is definitive
    case "HttpHook":
      return 0;
    // IPC / WebSocket: reliable, use a short threshold
    case "IpcSocket":
    case "WebSocket":
      return Math.min(thresholdSecs * 1000, 2000);
    // capture-pane and others: subject to flicker, full threshold
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

// Hook: watch agent list for Processing → Idle transitions and fire browser notifications.
export function useIdleNotification(agents: AgentSnapshot[], config: IdleNotificationConfig) {
  // Track per-agent idle state
  const stateMap = useRef(new Map<string, AgentIdleState>());
  // Track previous status per agent
  const prevStatusMap = useRef(new Map<string, string>());

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
      prevStatusMap.current.clear();
      return;
    }

    const currentIds = new Set<string>();

    for (const agent of agents) {
      // Only track AI agents
      if (!isAiAgent(agent.agent_type)) continue;

      currentIds.add(agent.id);
      const status = statusName(agent.status);
      const prevStatus = prevStatusMap.current.get(agent.id);
      prevStatusMap.current.set(agent.id, status);

      const idleState = stateMap.current.get(agent.id);

      if (status === "Idle" || status === "Offline") {
        // Agent is idle — was it previously processing?
        if (prevStatus === "Processing" && !idleState?.notified) {
          // Transition detected: Processing → Idle
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
        // If already idle and already notified (or no transition), do nothing
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
        prevStatusMap.current.delete(id);
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
