// Terminal-plane subscription hook (#174 Phase 3a, replaces legacy
// `connectTerminal`). Mints a short-lived ticket via
// `POST /api/agents/{id}/subscribe-terminal`, then opens two WebSockets
// against the stream_endpoint:
//
// - `?mode=stream` — receives ANSI byte chunks pushed by the PTY-server.
// - `?mode=keys`   — sends raw key bytes to the agent's stdin.
//
// The hook re-subscribes automatically before the ticket expires and
// reconnects on transport-level close. Both WebSockets close on unmount
// or `agentId` change.

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { TerminalSubscription } from "@/types/generated/TerminalSubscription";

export type TerminalStreamStatus =
  | "idle"
  | "subscribing"
  | "connecting"
  | "open"
  | "reconnecting"
  | "closed"
  | "error";

interface UseAgentTerminalStreamOptions {
  /** Canonical agent id (`<scheme>:<id>`). Pass `null` to disable. */
  agentId: string | null;
  /** Called with each ANSI byte chunk pushed by the agent's PTY. */
  onData: (bytes: Uint8Array) => void;
  /** Optional connection-state observer. */
  onStatus?: (status: TerminalStreamStatus) => void;
}

interface UseAgentTerminalStreamResult {
  /** Send key bytes to the agent's stdin. No-op while not `open`. */
  sendKeys: (data: Uint8Array | string | ArrayBuffer) => void;
  /** Latest connection status — also delivered through `onStatus`. */
  status: TerminalStreamStatus;
}

const RECONNECT_DELAY_MS = 3_000;
// Re-subscribe this far ahead of the ticket's expiry — must exceed the
// expected round-trip + WS open time so a fresh stream is ready before
// the old token is rejected.
const TICKET_REFRESH_LEAD_MS = 30_000;

function buildWsUrl(
  agentId: string,
  subscription: TerminalSubscription,
  mode: "stream" | "keys",
): string {
  const path =
    subscription.stream_endpoint ?? `/api/agents/${encodeURIComponent(agentId)}/terminal-stream`;
  const wsBase = window.location.origin.replace(/^http/, "ws");
  const sep = path.includes("?") ? "&" : "?";
  return `${wsBase}${path}${sep}ticket=${encodeURIComponent(subscription.token)}&mode=${mode}`;
}

export function useAgentTerminalStream({
  agentId,
  onData,
  onStatus,
}: UseAgentTerminalStreamOptions): UseAgentTerminalStreamResult {
  const [status, setStatus] = useState<TerminalStreamStatus>("idle");
  const streamWsRef = useRef<WebSocket | null>(null);
  const keysWsRef = useRef<WebSocket | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set to `true` on unmount or agentId change. Async tasks check this
  // before touching state or refs to avoid clobbering a stale agent.
  const abortedRef = useRef(false);

  // Stable handles so the effect doesn't re-run when callers pass
  // freshly-bound closures every render.
  const onDataRef = useRef(onData);
  const onStatusRef = useRef(onStatus);
  useEffect(() => {
    onDataRef.current = onData;
    onStatusRef.current = onStatus;
  }, [onData, onStatus]);

  const setStatusBoth = useCallback((s: TerminalStreamStatus): void => {
    setStatus(s);
    onStatusRef.current?.(s);
  }, []);

  useEffect(() => {
    if (!agentId) {
      setStatusBoth("idle");
      return;
    }
    abortedRef.current = false;

    const clearTimers = (): void => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const closeWebSockets = (): void => {
      if (streamWsRef.current) {
        streamWsRef.current.close(1000);
        streamWsRef.current = null;
      }
      if (keysWsRef.current) {
        keysWsRef.current.close(1000);
        keysWsRef.current = null;
      }
    };

    const scheduleRefresh = (expiresAt: string): void => {
      const expiresMs = Date.parse(expiresAt);
      // Wall-clock parse can fail or yield NaN — guard with a sane floor
      // so we still refresh after a few minutes rather than never.
      const rawDelay = Number.isFinite(expiresMs)
        ? Math.max(1_000, expiresMs - Date.now() - TICKET_REFRESH_LEAD_MS)
        : 60_000;
      // setTimeout clamps to a 32-bit signed int internally; values past
      // ~24.8 days (2_147_483_647 ms) get coerced to 1 ms and fire
      // immediately. Cap at 1 hour — a far-future expires_at is fine, we
      // just want to wake up periodically and re-evaluate.
      const safeDelay = Math.min(rawDelay, 60 * 60 * 1_000);
      refreshTimerRef.current = setTimeout(() => {
        if (abortedRef.current) return;
        void connect();
      }, safeDelay);
    };

    const connect = async (): Promise<void> => {
      if (abortedRef.current) return;
      clearTimers();
      try {
        setStatusBoth("subscribing");
        const subscription = await api.subscribeTerminal(agentId);
        if (abortedRef.current) return;

        // Tear down the previous pair before opening new ones. There is a
        // narrow window where bytes mid-flight on the old stream are
        // dropped; the supervisor's scrollback (#175) is the durable
        // catch-up mechanism.
        closeWebSockets();

        setStatusBoth("connecting");
        const stream = new WebSocket(buildWsUrl(agentId, subscription, "stream"));
        stream.binaryType = "arraybuffer";
        const keys = new WebSocket(buildWsUrl(agentId, subscription, "keys"));
        keys.binaryType = "arraybuffer";

        streamWsRef.current = stream;
        keysWsRef.current = keys;

        stream.onmessage = (e: MessageEvent): void => {
          if (abortedRef.current) return;
          if (e.data instanceof ArrayBuffer) {
            onDataRef.current(new Uint8Array(e.data));
          } else if (typeof e.data === "string") {
            onDataRef.current(new TextEncoder().encode(e.data));
          }
        };
        stream.onopen = (): void => {
          if (abortedRef.current) return;
          setStatusBoth("open");
        };
        stream.onclose = (): void => {
          if (abortedRef.current) return;
          if (streamWsRef.current !== stream) return; // already replaced
          streamWsRef.current = null;
          setStatusBoth("reconnecting");
          reconnectTimerRef.current = setTimeout(() => {
            if (abortedRef.current) return;
            void connect();
          }, RECONNECT_DELAY_MS);
        };
        // onerror is best-effort: onclose follows reliably and drives
        // the reconnect path.
        stream.onerror = (): void => {};

        scheduleRefresh(subscription.expires_at);
      } catch {
        if (abortedRef.current) return;
        setStatusBoth("error");
        reconnectTimerRef.current = setTimeout(() => {
          if (abortedRef.current) return;
          void connect();
        }, RECONNECT_DELAY_MS);
      }
    };

    void connect();

    return () => {
      abortedRef.current = true;
      clearTimers();
      closeWebSockets();
      setStatus("closed");
    };
  }, [agentId, setStatusBoth]);

  const sendKeys = useCallback((data: Uint8Array | string | ArrayBuffer): void => {
    const ws = keysWsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (typeof data === "string") {
      // Send as binary so the supervisor's read loop sees the same byte
      // shape both modes use.
      ws.send(new TextEncoder().encode(data).buffer);
    } else {
      ws.send(data);
    }
  }, []);

  return { sendKeys, status };
}
