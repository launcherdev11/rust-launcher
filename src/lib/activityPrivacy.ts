import { useSyncExternalStore } from "react";

const STORAGE_KEY = "friends_activity_sharing";
const CHANGED_EVENT = "friends-activity-sharing-changed";

function readActivitySharing(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGED_EVENT, onChange);
  return () => window.removeEventListener(CHANGED_EVENT, onChange);
}

export function setActivitySharing(enabled: boolean) {
  try {
    if (enabled) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, "off");
  } catch {
  }
  window.dispatchEvent(new Event(CHANGED_EVENT));
}

export function useActivitySharing(): boolean {
  return useSyncExternalStore(subscribe, readActivitySharing);
}
