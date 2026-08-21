import { apiFetch } from "./client";
import { ensureValidAccessToken } from "./auth";

export type PresenceActivityKind =
  | "launcher"
  | "playing_modpack"
  | "playing_singleplayer_world"
  | "playing_server"
  | "playing_room_world";

export type PresenceActivity = {
  kind: PresenceActivityKind;
  launcher_tab?: string | null;
  modpack_name?: string | null;
  world_name?: string | null;
  server_name?: string | null;
  server_address?: string | null;
  room_id?: string | null;
  room_name?: string | null;
  room_member_nickname?: string | null;
  room_peer_name?: string | null;
  room_visibility?: string | null;
  started_at?: string | null;
};

export type PresenceInfo = {
  user_id: string;
  online: boolean;
  last_seen?: string | null;
  activity?: PresenceActivity | null;
};

export type PresenceHeartbeatPayload = {
  activity?: PresenceActivity | null;
};

type PresenceEnvelope =
  | { presence?: unknown }
  | PresenceInfo
  | null
  | undefined;

type PresenceListEnvelope =
  | { presence?: unknown; presences?: unknown }
  | PresenceInfo[]
  | null
  | undefined;

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asOptionalString(value: unknown): string | null | undefined {
  return typeof value === "string" ? value : value == null ? null : undefined;
}

function asOptionalTimestampString(value: unknown): string | null | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  return value == null ? null : undefined;
}

function asOptionalBoolean(value: unknown): boolean | null | undefined {
  return typeof value === "boolean" ? value : value == null ? null : undefined;
}

function normalizePresenceActivity(activity: unknown): PresenceActivity | null {
  const raw = asObject(activity);
  if (!raw) return null;

  const kind = asOptionalString(raw.kind);
  if (
    kind !== "launcher" &&
    kind !== "playing_modpack" &&
    kind !== "playing_singleplayer_world" &&
    kind !== "playing_server" &&
    kind !== "playing_room_world"
  ) {
    return null;
  }

  const roomPeerName =
    asOptionalString(raw.room_peer_name) ??
    asOptionalString(raw.roomPeerName) ??
    asOptionalString(raw.room_member_nickname) ??
    asOptionalString(raw.roomMemberNickname) ??
    null;

  return {
    kind,
    launcher_tab: asOptionalString(raw.launcher_tab) ?? asOptionalString(raw.launcherTab) ?? null,
    modpack_name: asOptionalString(raw.modpack_name) ?? asOptionalString(raw.modpackName) ?? null,
    world_name: asOptionalString(raw.world_name) ?? asOptionalString(raw.worldName) ?? null,
    server_name: asOptionalString(raw.server_name) ?? asOptionalString(raw.serverName) ?? null,
    server_address:
      asOptionalString(raw.server_address) ?? asOptionalString(raw.serverAddress) ?? null,
    room_id: asOptionalString(raw.room_id) ?? asOptionalString(raw.roomId) ?? null,
    room_name: asOptionalString(raw.room_name) ?? asOptionalString(raw.roomName) ?? null,
    room_member_nickname: roomPeerName,
    room_peer_name: roomPeerName,
    room_visibility:
      asOptionalString(raw.room_visibility) ??
      asOptionalString(raw.roomVisibility) ??
      asOptionalString(raw.visibility) ??
      null,
    started_at:
      asOptionalTimestampString(raw.started_at) ??
      asOptionalTimestampString(raw.startedAt) ??
      null,
  };
}

export function normalizePresenceInfo(input: unknown): PresenceInfo | null {
  const raw = asObject(input);
  if (!raw) return null;

  const userId = asOptionalString(raw.user_id) ?? asOptionalString(raw.userId);
  if (!userId) return null;

  const online = asOptionalBoolean(raw.online);
  if (typeof online !== "boolean") return null;

  return {
    user_id: userId,
    online,
    last_seen:
      asOptionalTimestampString(raw.last_seen) ??
      asOptionalTimestampString(raw.lastSeen) ??
      null,
    activity: normalizePresenceActivity(raw.activity),
  };
}

function unwrapPresence(envelope: PresenceEnvelope): PresenceInfo | null {
  const raw = asObject(envelope);
  if (raw && "presence" in raw) {
    return normalizePresenceInfo(raw.presence);
  }
  return normalizePresenceInfo(envelope);
}

function unwrapPresenceList(envelope: PresenceListEnvelope): PresenceInfo[] {
  const raw = asObject(envelope);
  const list = raw
    ? Array.isArray(raw.presence)
      ? raw.presence
      : Array.isArray(raw.presences)
        ? raw.presences
        : []
    : Array.isArray(envelope)
      ? envelope
      : [];
  return list.map(normalizePresenceInfo).filter((item): item is PresenceInfo => Boolean(item));
}

export async function sendPresenceHeartbeat(payload?: PresenceHeartbeatPayload): Promise<PresenceInfo> {
  await ensureValidAccessToken();
  const data = await apiFetch<{ presence: PresenceInfo }>("/presence/heartbeat", {
    method: "POST",
    body: JSON.stringify(payload ?? {}),
  });
  return unwrapPresence(data) ?? data.presence;
}

export async function sendPresenceOffline(): Promise<PresenceInfo> {
  await ensureValidAccessToken();
  const data = await apiFetch<{ presence: PresenceInfo }>("/presence/offline", {
    method: "POST",
  });
  return unwrapPresence(data) ?? data.presence;
}

export async function fetchMyPresence(): Promise<PresenceInfo> {
  await ensureValidAccessToken();
  const data = await apiFetch<{ presence: PresenceInfo }>("/presence/me");
  return unwrapPresence(data) ?? data.presence;
}

export async function fetchFriendsPresence(): Promise<PresenceInfo[]> {
  await ensureValidAccessToken();
  const data = await apiFetch<{ presence: PresenceInfo[] }>("/presence/friends");
  return unwrapPresenceList(data);
}
