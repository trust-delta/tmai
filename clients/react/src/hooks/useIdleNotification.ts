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
//
// Step 5 of the agent-state attention rebuild (decision tmai-core@2026-05-07):
// the legacy state machine is dismantled, so the historical
// "Processing → Idle" status transition no longer fires for new tmai-core
// servers. The new `attention.required` axis (Step 4a / 4b) carries the
// transition instead. The hook now triggers when **either** signal flips
// "becomes attention-needed":
//
//   1. `attention.required` goes false / undefined → true
//      (primary path; covers both CC hook fire and PTY-server fallback)
//   2. legacy `status` goes Processing → Idle / Offline
//      (compat fallback for snapshots from pre-Step 4 tmai-core)
//
// The two paths converge during the parallel-run period; Step 6 retires
// the legacy path along with the rest of the status field.
export function useIdleNotification(agents: AgentSnapshot[], config: IdleNotificationConfig) {
  // Track per-agent idle state
  const stateMap = useRef(new Map<string, AgentIdleState>());
  // Track previous status per agent (legacy path)
  const prevStatusMap = useRef(new Map<string, string>());
  // Track previous attention.required per agent (Step 5 primary path)
  const prevAttentionMap = useRef(new Map<string, boolean>());

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
      prevAttentionMap.current.clear();
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
      const attentionRequired = agent.attention?.required ?? false;
      const prevAttention = prevAttentionMap.current.get(agent.id);
      prevAttentionMap.current.set(agent.id, attentionRequired);

      const idleState = stateMap.current.get(agent.id);

      // Step 5: "needs the human" condition is true when either the new
      // attention axis says so or the legacy status is Idle / Offline.
      const needsHuman = attentionRequired || status === "Idle" || status === "Offline";
      // A *fresh* trigger requires a transition into the needs-human state
      // on at least one of the two signals — otherwise re-renders would
      // re-fire notifications for an agent that has been idle for hours.
      // The attention path explicitly compares against `false` (not `!prevAttention`)
      // so the first observation of an agent (`prevAttention === undefined`)
      // does NOT count as a transition: a freshly-loaded tab must not
      // shower the user with notifications for agents that have been
      // requiring attention since long before the tab opened. CodeRabbit
      // tmai#618.
      const attentionTrigger = prevAttention === false && attentionRequired;
      const statusTrigger =
        prevStatus === "Processing" && (status === "Idle" || status === "Offline");
      const justBecameNeedsHuman = attentionTrigger || statusTrigger;

      if (needsHuman) {
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
        prevStatusMap.current.delete(id);
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
