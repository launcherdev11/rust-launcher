import { listen, type EventCallback, type UnlistenFn } from "@tauri-apps/api/event";

export function subscribeTauriEvent<T>(
  event: string,
  handler: EventCallback<T>,
): () => void {
  let disposed = false;
  let unlisten: UnlistenFn | null = null;

  listen<T>(event, (e) => {
    if (!disposed) handler(e);
  })
    .then((fn) => {
      if (disposed) {
        try {
          fn();
        } catch {
        }
      } else {
        unlisten = fn;
      }
    })
    .catch((e) => console.error(`Failed to subscribe to "${event}":`, e));

  return () => {
    disposed = true;
    if (unlisten) {
      try {
        unlisten();
      } catch {
      }
      unlisten = null;
    }
  };
}

export function disposeWhenResolved(subscription: Promise<UnlistenFn>): () => void {
  let disposed = false;
  let unlisten: UnlistenFn | null = null;

  subscription
    .then((fn) => {
      if (disposed) {
        try {
          fn();
        } catch {
        }
      } else {
        unlisten = fn;
      }
    })
    .catch(console.error);

  return () => {
    disposed = true;
    if (unlisten) {
      try {
        unlisten();
      } catch {
      }
      unlisten = null;
    }
  };
}
