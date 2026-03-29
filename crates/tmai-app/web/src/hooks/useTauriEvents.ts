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
    let active = true;
    let unsubscribe: UnlistenFn | null = null;

    listen<CoreEvent>("core-event", handleEvent)
      .then((fn) => {
        if (active) {
          unsubscribe = fn;
        } else {
          // Cleanup ran before listen resolved — unlisten immediately
          fn();
        }
      })
      .catch((_e) => {});

    return () => {
      active = false;
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [handleEvent]);

  return { isListening: true };
}
