// Hook for listening to Tauri core-event emissions

import type { UnlistenFn } from "@tauri-apps/api/event";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect } from "react";

export interface CoreEvent {
  type: string;
  data: unknown;
}

export function useTauriEvents(onEvent: (event: CoreEvent) => void): { isListening: boolean } {
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
      .catch((_e) => {});

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [handleEvent]);

  return { isListening: true };
}
