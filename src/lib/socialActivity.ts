import type { PresenceInfo, PresenceActivity } from "../api/presence";

type Translator = (key: string, vars?: Record<string, string | number>) => string;

export type RoomPresenceContext = {
  roomId: string;
  roomName?: string | null;
  visibility?: string | null;
  joinCode?: string | null;
  memberNicknames?: string[];
  sessionStartedAt?: string | null;
};

export type LaunchPresenceContext =
  | {
      kind: "modpack";
      startedAt?: string | null;
    }
  | {
      kind: "server";
      serverAddress: string;
      serverName?: string | null;
      startedAt?: string | null;
    }
  | {
      kind: "room_world";
      serverAddress?: string | null;
      worldName?: string | null;
      startedAt?: string | null;
    };

export function derivePresenceActivity(params: {
  gameStatus: "idle" | "running" | "stopped" | "crashed";
  activeItem: string;
  activeInstanceName?: string | null;
  roomContext?: RoomPresenceContext | null;
  launchContext?: LaunchPresenceContext | null;
}): PresenceActivity {
  const { gameStatus, activeItem, activeInstanceName, roomContext, launchContext } = params;
  const roomPeerName = pickOtherRoomMember(roomContext?.memberNicknames);

  if (gameStatus !== "running") {
    return {
      kind: "launcher",
      launcher_tab: activeItem,
      modpack_name: activeInstanceName ?? null,
      room_id: roomContext?.roomId ?? null,
      room_name: roomContext?.roomName ?? null,
      room_member_nickname: roomPeerName,
      room_peer_name: roomPeerName,
      room_visibility: roomContext?.visibility ?? null,
      started_at: null,
    };
  }

  if (launchContext?.kind === "room_world") {
    return {
      kind: "playing_room_world",
      modpack_name: activeInstanceName ?? null,
      world_name: launchContext.worldName ?? roomContext?.roomName ?? activeInstanceName ?? null,
      room_id: roomContext?.roomId ?? null,
      room_name: roomContext?.roomName ?? null,
      room_member_nickname: roomPeerName,
      room_peer_name: roomPeerName,
      room_visibility: roomContext?.visibility ?? null,
      server_address: launchContext.serverAddress ?? null,
      started_at: launchContext.startedAt ?? roomContext?.sessionStartedAt ?? null,
    };
  }

  if (launchContext?.kind === "server") {
    return {
      kind: "playing_server",
      modpack_name: activeInstanceName ?? null,
      server_address: launchContext.serverAddress,
      server_name: launchContext.serverName ?? prettifyServerAddress(launchContext.serverAddress),
      room_id: roomContext?.roomId ?? null,
      room_name: roomContext?.roomName ?? null,
      room_member_nickname: roomPeerName,
      room_peer_name: roomPeerName,
      room_visibility: roomContext?.visibility ?? null,
      started_at: launchContext.startedAt ?? null,
    };
  }

  return {
    kind: "playing_modpack",
    modpack_name: activeInstanceName ?? null,
    room_id: roomContext?.roomId ?? null,
    room_name: roomContext?.roomName ?? null,
    room_member_nickname: roomPeerName,
    room_peer_name: roomPeerName,
    room_visibility: roomContext?.visibility ?? null,
    started_at: launchContext?.startedAt ?? roomContext?.sessionStartedAt ?? null,
  };
}

export function formatPresenceStatus(
  presence: PresenceInfo | null | undefined,
  tt: Translator,
): string {
  if (!presence?.online) {
    return tt("friends.offline");
  }

  const activity = presence.activity;
  if (!activity) {
    return tt("friends.online");
  }

  switch (activity.kind) {
    case "launcher":
      return tt("friends.status.launcher");
    case "playing_modpack":
      return activity.modpack_name
        ? tt("friends.status.playingModpackNamed", { name: activity.modpack_name })
        : tt("friends.status.playingModpack");
    case "playing_server": {
      const serverName =
        activity.server_name?.trim() || prettifyServerAddress(activity.server_address) || null;
      return serverName
        ? tt("friends.status.playingServerNamed", { name: serverName })
        : tt("friends.status.playingServer");
    }
    case "playing_singleplayer_world": {
      const worldName = activity.world_name?.trim() || activity.room_name?.trim() || null;
      return worldName
        ? tt("friends.status.playingWorldNamed", { name: worldName })
        : tt("friends.status.playingWorld");
    }
    case "playing_room_world": {
      const worldName =
        activity.world_name?.trim() ||
        activity.server_name?.trim() ||
        activity.room_name?.trim() ||
        tt("friends.status.roomFallback");
      const roomName = activity.room_name?.trim() || null;
      const memberName =
        activity.room_peer_name?.trim() || activity.room_member_nickname?.trim() || null;

      if (memberName && roomName) {
        return tt("friends.status.playingRoomWorldWithNamedRoom", {
          world: worldName,
          nick: memberName,
          room: roomName,
        });
      }
      if (memberName) {
        return tt("friends.status.playingRoomWorldWith", {
          world: worldName,
          nick: memberName,
        });
      }
      if (roomName) {
        return tt("friends.status.playingRoomWorldNamedRoom", {
          world: worldName,
          room: roomName,
        });
      }
      return tt("friends.status.playingRoomWorld", { world: worldName });
    }
    default:
      return tt("friends.online");
  }
}

export function formatRoomVisibility(visibility: string | null | undefined, tt: Translator): string {
  if (visibility === "private") return tt("rooms.visibility.private");
  if (visibility === "public") return tt("rooms.visibility.public");
  return tt("rooms.visibility.unknown");
}

export function formatDurationShort(totalSeconds: number, tt: Translator): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  if (hours > 0) {
    return tt("rooms.sessionPlaytimeHours", { h: hours, m: minutes });
  }
  if (minutes > 0) {
    return tt("rooms.sessionPlaytimeMinutes", { m: minutes, s: seconds });
  }
  return tt("rooms.sessionPlaytimeSeconds", { s: seconds });
}

export function getElapsedSeconds(startedAt: string | null | undefined, nowMs: number): number | null {
  if (!startedAt) return null;
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started)) return null;
  return Math.max(0, Math.floor((nowMs - started) / 1000));
}

export function pickOtherRoomMember(memberNicknames: string[] | null | undefined): string | null {
  if (!memberNicknames || memberNicknames.length === 0) return null;
  const sorted = memberNicknames
    .map((name) => name.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  return sorted[0] ?? null;
}

export function prettifyServerAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  const trimmed = address.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("127.0.0.1:")) return "LAN";
  return trimmed;
}
