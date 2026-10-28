import { useSyncExternalStore } from "react";
import { listen } from "@tauri-apps/api/event";

const EVENT_WINDOW_IDLE = "window-idle";

let idle = false;
let started = false;
const listeners = new Set<() => void>();

function setIdle(next: boolean) {
  if (idle === next) return;
  idle = next;
  if (next) {
    document.documentElement.dataset.windowIdle = "true";
  } else {
    delete document.documentElement.dataset.windowIdle;
  }
  listeners.forEach((notify) => notify());
}

export function startWindowIdleTracking() {
  if (started || typeof window === "undefined") return;
  started = true;
  void listen<boolean>(EVENT_WINDOW_IDLE, (event) => setIdle(event.payload === true)).catch(
    () => {
      started = false;
    },
  );
}

function subscribe(notify: () => void) {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}

export function useWindowIdle(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => idle,
    () => false,
  );
}
