import { invoke } from "@tauri-apps/api/core";
import { installGameAndLoader, type InstallLoaderId } from "../../lib/installGameAndLoader";
import type { SyncManifest } from "./protocol";

const HOST_KEY = "room_modpack_host";
const GUEST_KEY = "room_modpack_ready";
const MAX_ENTRIES = 50;

const LOADERS: InstallLoaderId[] = ["vanilla", "fabric", "quilt", "forge", "neoforge"];

function readMap(key: string): Record<string, string> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeEntry(key: string, roomId: string, profileId: string) {
  const map = readMap(key);
  delete map[roomId];
  map[roomId] = profileId;
  const entries = Object.entries(map).slice(-MAX_ENTRIES);
  try {
    window.localStorage.setItem(key, JSON.stringify(Object.fromEntries(entries)));
  } catch {
  }
}

export function getHostRoomProfile(roomId: string): string | null {
  return readMap(HOST_KEY)[roomId] ?? null;
}

export function setHostRoomProfile(roomId: string, profileId: string) {
  writeEntry(HOST_KEY, roomId, profileId);
}

export function getGuestRoomProfile(roomId: string): string | null {
  return readMap(GUEST_KEY)[roomId] ?? null;
}

export function setGuestRoomProfile(roomId: string, profileId: string) {
  writeEntry(GUEST_KEY, roomId, profileId);
}

export function profileMatchesRoom(
  profile: { game_version: string; loader: string },
  room: { game_version?: string | null; loader?: string | null },
): boolean {
  const roomVersion = room.game_version?.trim() ?? "";
  const version = profile.game_version.trim();
  if ((profile.loader || "vanilla") !== (room.loader?.trim() || "vanilla")) return false;
  return roomVersion === version || roomVersion.startsWith(`${version}-`);
}

export async function createProfileForRoom(name: string, manifest: SyncManifest): Promise<string> {
  const loader = LOADERS.find((l) => l === manifest.loader);
  const loaderVersion = manifest.loaderVersion?.trim() || null;
  if (!loader || !manifest.gameVersion.trim() || (loader !== "vanilla" && !loaderVersion)) {
    throw new Error(`${manifest.loader} ${manifest.gameVersion}`);
  }
  const created = await invoke<{ id: string }>("create_profile", {
    name,
    gameVersion: manifest.gameVersion,
    loader,
    loaderVersion,
    iconSourcePath: null,
    initialSettings: null,
  });
  await installGameAndLoader(manifest.gameVersion, loader, loaderVersion);
  return created.id;
}
