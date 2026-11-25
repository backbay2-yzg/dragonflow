import { useEffect, useRef } from "react";
import { Events } from "@wailsio/runtime";
import { AppFocusTask, AppNavigate, DragonflowEvent } from "../../bindings/events";
import type { AppEvent } from "../../bindings/github.com/dragonflow/desktop/internal/domain/models";

export function useWailsEvents(handlers: {
  onAppEvent?: (ev: AppEvent) => void;
  onFocusTask?: (taskID: string) => void;
  onNavigate?: (tab: string) => void;
}) {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  }, [handlers]);

  useEffect(() => {
    const offApp = Events.On(DragonflowEvent, (msg) => {
      const payload = msg?.data as AppEvent | undefined;
      if (payload) {
        ref.current.onAppEvent?.(payload);
      }
    });
    const offFocus = Events.On(AppFocusTask, (msg) => {
      const taskID = msg?.data as string | undefined;
      if (taskID) {
        ref.current.onFocusTask?.(taskID);
      }
    });
    const offNav = Events.On(AppNavigate, (msg) => {
      const tab = msg?.data as string | undefined;
      if (tab) {
        ref.current.onNavigate?.(tab);
      }
    });

    return () => {
      offApp?.();
      offFocus?.();
      offNav?.();
    };
  }, []);
}
