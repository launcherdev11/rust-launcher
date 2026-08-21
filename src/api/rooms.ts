import { apiFetch } from "./client";
import { ensureValidAccessToken } from "./auth";

export type RoomMember = {
  user_id: string;
  nickname: string;
  role: string;
  is_sponsor?: boolean;
  ely_username?: string | null;
  mc_uuid?: string | null;
  joined_at?: string;
};

export type Room = {
  id: string;
  owner_user_id: string;
  status: string;
  name?: string | null;
  visibility?: "public" | "private" | string | null;
  join_code?: string | null;
  invite_only?: boolean | null;
  max_players: number;
  member_count: number;
  created_at?: string;
  session_started_at?: string | null;
  members?: RoomMember[];
};

type RoomEnvelope = { room?: unknown } | Room | null | undefined;
type RoomListEnvelope = { rooms?: unknown } | Room[] | null | undefined;

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

function asLooseBoolean(value: unknown): boolean | null | undefined {
  if (typeof value === "boolean" || value == null) {
    return asOptionalBoolean(value);
  }
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
    if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  }
  return undefined;
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeRoomVisibility(raw: Record<string, unknown>): "public" | "private" | string | null {
  const visibility =
    asOptionalString(raw.visibility) ??
    asOptionalString(raw.room_visibility) ??
    asOptionalString(raw.roomVisibility);
  if (visibility === "public" || visibility === "private") return visibility;
  const privateFlag =
    asLooseBoolean(raw.is_private) ??
    asLooseBoolean(raw.isPrivate) ??
    asLooseBoolean(raw.private);
  if (typeof privateFlag === "boolean") {
    return privateFlag ? "private" : "public";
  }
  return visibility ?? null;
}

function normalizeRoomMember(input: unknown): RoomMember | null {
  const raw = asObject(input);
  if (!raw) return null;

  const userId = asOptionalString(raw.user_id) ?? asOptionalString(raw.userId);
  const nickname = asOptionalString(raw.nickname) ?? asOptionalString(raw.nick);
  const role = asOptionalString(raw.role);
  if (!userId || !nickname || !role) return null;

  return {
    user_id: userId,
    nickname,
    role,
    is_sponsor:
      asLooseBoolean(raw.is_sponsor) ?? asLooseBoolean(raw.isSponsor) ?? undefined,
    ely_username:
      asOptionalString(raw.ely_username) ?? asOptionalString(raw.elyUsername) ?? null,
    mc_uuid: asOptionalString(raw.mc_uuid) ?? asOptionalString(raw.mcUuid) ?? null,
    joined_at:
      asOptionalTimestampString(raw.joined_at) ??
      asOptionalTimestampString(raw.joinedAt) ??
      undefined,
  };
}

export function normalizeRoom(input: unknown): Room | null {
  const raw = asObject(input);
  if (!raw) return null;

  const id = asOptionalString(raw.id) ?? asOptionalString(raw.room_id) ?? asOptionalString(raw.roomId);
  const ownerUserId =
    asOptionalString(raw.owner_user_id) ??
    asOptionalString(raw.ownerUserId) ??
    asOptionalString(asObject(raw.owner)?.user_id) ??
    asOptionalString(asObject(raw.owner)?.id);
  const status = asOptionalString(raw.status);
  const membersSource = Array.isArray(raw.members)
    ? raw.members
    : Array.isArray(raw.participants)
      ? raw.participants
      : Array.isArray(raw.users)
        ? raw.users
        : null;
  const members = membersSource
    ? membersSource.map(normalizeRoomMember).filter((item): item is RoomMember => Boolean(item))
    : undefined;
  const maxPlayers =
    asOptionalNumber(raw.max_players) ??
    asOptionalNumber(raw.maxPlayers) ??
    asOptionalNumber(raw.max_members) ??
    asOptionalNumber(raw.maxMembers);
  const memberCount =
    asOptionalNumber(raw.member_count) ??
    asOptionalNumber(raw.memberCount) ??
    (members ? members.length : undefined);
  const statusFallback = memberCount != null && maxPlayers != null
    ? memberCount >= maxPlayers
      ? "full"
      : "open"
    : null;
  if (!id || !ownerUserId || !(status ?? statusFallback) || maxPlayers == null || memberCount == null) {
    return null;
  }

  return {
    id,
    owner_user_id: ownerUserId,
    status: status ?? statusFallback!,
    name: asOptionalString(raw.name) ?? asOptionalString(raw.room_name) ?? asOptionalString(raw.roomName) ?? null,
    visibility: normalizeRoomVisibility(raw),
    join_code:
      asOptionalString(raw.join_code) ??
      asOptionalString(raw.joinCode) ??
      asOptionalString(raw.code) ??
      asOptionalString(raw.invite_code) ??
      asOptionalString(raw.inviteCode) ??
      null,
    invite_only:
      asLooseBoolean(raw.invite_only) ??
      asLooseBoolean(raw.inviteOnly) ??
      asLooseBoolean(raw.private) ??
      null,
    max_players: maxPlayers,
    member_count: memberCount,
    created_at:
      asOptionalTimestampString(raw.created_at) ??
      asOptionalTimestampString(raw.createdAt) ??
      undefined,
    session_started_at:
      asOptionalTimestampString(raw.session_started_at) ??
      asOptionalTimestampString(raw.sessionStartedAt) ??
      asOptionalTimestampString(asObject(raw.session)?.started_at) ??
      asOptionalTimestampString(asObject(raw.session)?.startedAt) ??
      null,
    members,
  };
}

function unwrapRoom(envelope: RoomEnvelope): Room | null {
  const raw = asObject(envelope);
  if (raw && "room" in raw) {
    return normalizeRoom(raw.room);
  }
  return normalizeRoom(envelope);
}

function unwrapRoomList(envelope: RoomListEnvelope): Room[] {
  const raw = asObject(envelope);
  const list = raw
    ? Array.isArray(raw.rooms)
      ? raw.rooms
      : Array.isArray(raw.friends_rooms)
        ? raw.friends_rooms
        : Array.isArray(raw.friend_rooms)
          ? raw.friend_rooms
          : Array.isArray(raw.friendsRooms)
            ? raw.friendsRooms
            : Array.isArray(raw.data)
              ? raw.data
              : []
    : Array.isArray(envelope)
      ? envelope
      : [];
  return list.map(normalizeRoom).filter((item): item is Room => Boolean(item));
}

export async function listRooms(): Promise<Room[]> {
  await ensureValidAccessToken();
  const data = await apiFetch<{ rooms: Room[] }>("/rooms");
  return unwrapRoomList(data);
}

export async function listFriendsRooms(): Promise<Room[]> {
  await ensureValidAccessToken();
  const data = await apiFetch<{ rooms: Room[] }>("/rooms/friends");
  return unwrapRoomList(data);
}

export async function getRoom(roomId: string): Promise<Room> {
  await ensureValidAccessToken();
  const data = await apiFetch<{ room: Room }>(`/rooms/${roomId}`);
  return unwrapRoom(data) ?? data.room;
}

export type CreateRoomInput = {
  maxPlayers?: number;
  name?: string;
  visibility?: "public" | "private";
  /** Private-room password (sent as `password`; backend also accepts `join_code`). Required for private rooms. */
  password?: string;
};

export async function createRoom(input?: number | CreateRoomInput): Promise<Room> {
  await ensureValidAccessToken();
  const body: {
    max_players?: number;
    name?: string;
    visibility?: "public" | "private";
    password?: string;
  } = {};
  if (typeof input === "number") {
    body.max_players = input;
  } else if (input && typeof input === "object") {
    if (typeof input.maxPlayers === "number") {
      body.max_players = input.maxPlayers;
    }
    if (typeof input.name === "string" && input.name.trim()) {
      body.name = input.name.trim();
    }
    if (input.visibility === "public" || input.visibility === "private") {
      body.visibility = input.visibility;
    }
    if (typeof input.password === "string" && input.password.trim()) {
      body.password = input.password.trim();
    }
  }
  const data = await apiFetch<{ room: Room }>("/rooms", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return unwrapRoom(data) ?? data.room;
}

export async function joinRoom(
  roomIdOrNameOrCode: string,
  opts?: { password?: string },
): Promise<Room> {
  await ensureValidAccessToken();
  const trimmed = roomIdOrNameOrCode.trim();
  const password = opts?.password?.trim();
  const body: { room_id?: string; name?: string; password?: string } = {};

  const looksLikeUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      trimmed,
    );
  if (looksLikeUuid) {
    body.room_id = trimmed;
    if (password) body.password = password;
  } else if (trimmed) {
    // Display name (public rooms) or name + password (private rooms).
    body.name = trimmed;
    if (password) body.password = password;
  } else if (password) {
    // Password-only lookup for private rooms.
    body.password = password;
  }

  const data = await apiFetch<{ room: Room }>("/rooms/join", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return unwrapRoom(data) ?? data.room;
}

export async function leaveRoom(roomId: string, kickUserId?: string): Promise<void> {
  await ensureValidAccessToken();
  const body: { room_id: string; user_id?: string } = { room_id: roomId };
  if (kickUserId) {
    body.user_id = kickUserId;
  }
  await apiFetch("/rooms/leave", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function inviteToRoom(roomId: string, nickname: string): Promise<Room> {
  await ensureValidAccessToken();
  const data = await apiFetch<{ room: Room }>("/rooms/invite", {
    method: "POST",
    body: JSON.stringify({ room_id: roomId, nickname }),
  });
  return unwrapRoom(data) ?? data.room;
}

export async function closeRoom(roomId: string): Promise<void> {
  await ensureValidAccessToken();
  await apiFetch(`/rooms/${roomId}`, { method: "DELETE" });
}

export type RoomSession = {
  id: string;
  room_id: string;
  host_user_id: string;
  state: string;
  started_at?: string | null;
  connection_type?: string | null;
  created_at: string;
  closed_at?: string | null;
};

type RoomSessionEnvelope = { session?: unknown } | RoomSession | null | undefined;

export function normalizeRoomSession(input: unknown): RoomSession | null {
  const raw = asObject(input);
  if (!raw) return null;

  const id = asOptionalString(raw.id) ?? asOptionalString(raw.session_id) ?? asOptionalString(raw.sessionId);
  const roomId = asOptionalString(raw.room_id) ?? asOptionalString(raw.roomId);
  const hostUserId =
    asOptionalString(raw.host_user_id) ?? asOptionalString(raw.hostUserId);
  const state = asOptionalString(raw.state);
  const createdAt = asOptionalString(raw.created_at) ?? asOptionalString(raw.createdAt);
  if (!id || !roomId || !hostUserId || !state || !createdAt) return null;

  return {
    id,
    room_id: roomId,
    host_user_id: hostUserId,
    state,
    started_at:
      asOptionalTimestampString(raw.started_at) ??
      asOptionalTimestampString(raw.startedAt) ??
      null,
    connection_type:
      asOptionalString(raw.connection_type) ?? asOptionalString(raw.connectionType) ?? null,
    created_at: createdAt,
    closed_at:
      asOptionalTimestampString(raw.closed_at) ??
      asOptionalTimestampString(raw.closedAt) ??
      null,
  };
}

function unwrapRoomSession(envelope: RoomSessionEnvelope): RoomSession | null {
  const raw = asObject(envelope);
  if (raw && "session" in raw) {
    return normalizeRoomSession(raw.session);
  }
  return normalizeRoomSession(envelope);
}

export async function getRoomSession(roomId: string): Promise<RoomSession | null> {
  await ensureValidAccessToken();
  const data = await apiFetch<{ session: RoomSession | null }>(`/rooms/${roomId}/session`);
  return unwrapRoomSession(data);
}

