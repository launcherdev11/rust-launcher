import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Room } from "../../api/rooms";

export type RoomLoaderId = "vanilla" | "fabric" | "quilt" | "forge" | "neoforge";

export type RoomVersionOption = {
  id: string;
  label: string;
};

export type RoomGameSettings = {
  loader: RoomLoaderId;
  gameVersion: string;
};

export type RoomCurrentGame = {
  loader: RoomLoaderId;
  gameVersion: string;
  loaderVersion?: string | null;
  source: "profile" | "menu";
  label: string;
  profileId?: string | null;
};

export const ROOM_LOADERS: RoomLoaderId[] = ["vanilla", "fabric", "quilt", "forge", "neoforge"];

export const MAX_ROOM_PLAYERS = 5;

export function isRoomLoaderId(value: string): value is RoomLoaderId {
  return (ROOM_LOADERS as string[]).includes(value);
}

export function roomLoaderOf(room: Room): RoomLoaderId {
  const loader = room.loader?.trim() ?? "";
  return isRoomLoaderId(loader) ? loader : "vanilla";
}

export function pickRoomVersionId(
  list: RoomVersionOption[],
  cur: RoomCurrentGame | null | undefined,
): string | null {
  if (!cur) return null;
  const gv = cur.gameVersion.trim();
  const lv = cur.loaderVersion?.trim();
  if (gv && list.some((v) => v.id === gv)) return gv;
  if (lv) {
    const hit = list.find((v) => v.id === lv) ?? list.find((v) => v.id.endsWith(`-${lv}`));
    if (hit) return hit.id;
  }
  if (gv) {
    const byMc = list.find((v) => v.label.startsWith(`${gv} (`));
    if (byMc) return byMc.id;
  }
  return null;
}

export function decodeJwtSub(token: string): string {
  const parts = token.split(".");
  if (parts.length < 2) return "";
  try {
    const payload = JSON.parse(atob(parts[1])) as { sub?: string };
    return typeof payload.sub === "string" ? payload.sub : "";
  } catch {
    return "";
  }
}

export function shortRoomId(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

export function isRoomVisibleToUser(room: Room, userId: string): boolean {
  if (room.visibility !== "private") return true;
  if (!userId) return false;
  if (room.owner_user_id === userId) return true;
  return (room.members ?? []).some((member) => member.user_id === userId);
}

export function isSameMinecraftVersion(worldVersion: string, selectedVersion: string): boolean {
  const world = worldVersion.trim().toLowerCase();
  const selected = selectedVersion.trim().toLowerCase();
  if (!world || !selected) return true;
  return world.includes(selected) || selected.includes(world);
}

async function loadVersionsForLoader(loader: RoomLoaderId): Promise<RoomVersionOption[]> {
  if (loader === "forge" || loader === "neoforge") {
    const command = loader === "forge" ? "fetch_forge_versions" : "fetch_neoforge_versions";
    const result = await invoke<Array<{ id: string; mc_version?: string }>>(command);
    return result.map((v) => ({
      id: v.id,
      label: v.mc_version ? `${v.mc_version} (${v.id})` : v.id,
    }));
  }
  const result = await invoke<Array<{ id: string }>>("fetch_versions_for_loader", {
    loader,
    showSnapshots: false,
    showAlpha: false,
  });
  return result.map((v) => ({ id: v.id, label: v.id }));
}

const NO_VERSIONS: RoomVersionOption[] = [];

export function useLoaderVersions(
  loader: RoomLoaderId,
  enabled: boolean,
  onError?: (message: string) => void,
): { versions: RoomVersionOption[]; loading: boolean } {
  const [loaded, setLoaded] = useState<{ loader: RoomLoaderId; list: RoomVersionOption[] } | null>(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void loadVersionsForLoader(loader)
      .then((list) => {
        if (!cancelled) setLoaded({ loader, list });
      })
      .catch((e) => {
        if (cancelled) return;
        setLoaded({ loader, list: NO_VERSIONS });
        onErrorRef.current?.(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, loader]);

  const ready = loaded?.loader === loader;
  return {
    versions: ready ? loaded.list : NO_VERSIONS,
    loading: enabled && !ready,
  };
}
