/** Create an EventSource with auto-reconnection */
export function createSSE(
  token: string,
  onAgents: (data: string) => void,
  onConnected: () => void,
  onDisconnected: () => void,
): { close: () => void } {
  let es: EventSource | null = null;
  let closed = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function connect() {
    if (closed) return;
    const url = `/api/events?token=${encodeURIComponent(token)}`;
    es = new EventSource(url);

    es.onopen = () => onConnected();

    es.addEventListener("agents", (e) => {
      onAgents(e.data);
    });

    es.onerror = () => {
      onDisconnected();
      es?.close();
      es = null;
      if (!closed) {
        reconnectTimer = setTimeout(connect, 3000);
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
