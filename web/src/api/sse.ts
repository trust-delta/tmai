/** Create an EventSource with auto-reconnection (exponential backoff) */
export function createSSE(
  token: string,
  onAgents: (data: string) => void,
  onConnected: () => void,
  onDisconnected: () => void,
): { close: () => void } {
  let es: EventSource | null = null;
  let closed = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let backoff = 1000; // start at 1s

  const MAX_BACKOFF = 30000; // cap at 30s

  function connect() {
    if (closed) return;
    const url = `/api/events?token=${encodeURIComponent(token)}`;
    es = new EventSource(url);

    es.onopen = () => {
      backoff = 1000; // reset on successful connection
      onConnected();
    };

    es.addEventListener("agents", (e) => {
      onAgents(e.data);
    });

    es.onerror = () => {
      onDisconnected();
      es?.close();
      es = null;
      if (!closed) {
        reconnectTimer = setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, MAX_BACKOFF);
      }
    };
  }

  connect();

  return {
    close() {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      es?.close();
      es = null;
    },
  };
}
