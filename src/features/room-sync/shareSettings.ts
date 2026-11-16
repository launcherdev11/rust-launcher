import { useSyncExternalStore } from "react";

export type RoomShareSettings = {
  enabled: boolean;
  configs: boolean;
};

const STORAGE_KEY = "room_sync_share";
const CHANGED_EVENT = "room-sync-share-changed";
const DEFAULTS: RoomShareSettings = { enabled: true, configs: true };

let cachedRaw: string | null | undefined;
let cachedValue: RoomShareSettings = DEFAULTS;

export function readRoomShareSettings(): RoomShareSettings {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
  }
  if (raw === cachedRaw) return cachedValue;
  cachedRaw = raw;
  try {
    const parsed = raw ? (JSON.parse(raw) as Partial<RoomShareSettings>) : {};
    cachedValue = {
      enabled: parsed.enabled ?? DEFAULTS.enabled,
      configs: parsed.configs ?? DEFAULTS.configs,
    };
  } catch {
    cachedValue = DEFAULTS;
  }
  return cachedValue;
}

export function updateRoomShareSettings(patch: Partial<RoomShareSettings>) {
  const next = { ...readRoomShareSettings(), ...patch };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
  }
  window.dispatchEvent(new Event(CHANGED_EVENT));
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGED_EVENT, onChange);
  return () => window.removeEventListener(CHANGED_EVENT, onChange);
}

export function useRoomShareSettings(): RoomShareSettings {
  return useSyncExternalStore(subscribe, readRoomShareSettings);
}
