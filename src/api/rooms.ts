import { apiFetch } from "./client";
import { ensureValidAccessToken } from "./auth";

export type RoomMember = {
  user_id: string;
  nickname: string;
  role: string;
  joined_at?: string;
};

export type Room = {
  id: string;
  owner_user_id: string;
  status: string;
  max_players: number;
  member_count: number;
  created_at?: string;
  members?: RoomMember[];
};

export async function listRooms(): Promise<Room[]> {
  await ensureValidAccessToken();
  const data = await apiFetch<{ rooms: Room[] }>("/rooms");
  return data.rooms ?? [];
}

/** Open rooms owned by friends that you have not joined yet. */
export async function listFriendsRooms(): Promise<Room[]> {
  await ensureValidAccessToken();
  const data = await apiFetch<{ rooms: Room[] }>("/rooms/friends");
  return data.rooms ?? [];
}

export async function getRoom(roomId: string): Promise<Room> {
  await ensureValidAccessToken();
  const data = await apiFetch<{ room: Room }>(`/rooms/${roomId}`);
  return data.room;
}

export async function createRoom(maxPlayers?: number): Promise<Room> {
  await ensureValidAccessToken();
  const body: { max_players?: number } = {};
  if (typeof maxPlayers === "number") {
    body.max_players = maxPlayers;
  }
  const data = await apiFetch<{ room: Room }>("/rooms", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return data.room;
}

export async function joinRoom(roomId: string): Promise<Room> {
  await ensureValidAccessToken();
  const data = await apiFetch<{ room: Room }>("/rooms/join", {
    method: "POST",
    body: JSON.stringify({ room_id: roomId }),
  });
  return data.room;
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
  return data.room;
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
  connection_type?: string | null;
  created_at: string;
  closed_at?: string | null;
};

export async function getRoomSession(roomId: string): Promise<RoomSession | null> {
  await ensureValidAccessToken();
  const data = await apiFetch<{ session: RoomSession | null }>(`/rooms/${roomId}/session`);
  return data.session ?? null;
}

