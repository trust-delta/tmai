// Hook for listening to Tauri core-event emissions
import { useEffect, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";

export interface CoreEvent {
  type: string;
  data: unknown;
}

export function useTauriEvents(
  onEvent: (event: CoreEvent) => void,
): { isListening: boolean } {
  const handleEvent = useCallback(
    (event: { payload: CoreEvent }) => {
      onEvent(event.payload);
    },
    [onEvent],
  );

  useEffect(() => {
    let unsubscribe: UnlistenFn | null = null;

    listen<CoreEvent>("core-event", handleEvent)
      .then((fn) => {
        unsubscribe = fn;
      })
      .catch((e) => {
        console.warn("Failed to listen for core-event (not in Tauri?)", e);
      });

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [handleEvent]);

  return { isListening: true };
}
