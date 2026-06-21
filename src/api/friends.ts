import { apiFetch } from "./client";
import { ensureValidAccessToken } from "./auth";

export type FriendRow = {
  user_id: string;
  nickname: string;
  ely_username?: string | null;
};

export type IncomingRequestRow = {
  request_id: string;
  from_user_id: string;
  from_nickname: string;
  from_ely_username?: string | null;
  created_at?: string;
};

export async function listFriends(): Promise<FriendRow[]> {
  await ensureValidAccessToken();
  const data = await apiFetch<{ friends: FriendRow[] }>("/friends");
  return data.friends ?? [];
}

export async function listIncomingRequests(): Promise<IncomingRequestRow[]> {
  await ensureValidAccessToken();
  const data = await apiFetch<{ incoming_requests: IncomingRequestRow[] }>("/friends/requests");
  return data.incoming_requests ?? [];
}

export async function sendFriendRequest(toNickname: string): Promise<{ already_exists: boolean }> {
  await ensureValidAccessToken();
  const data = await apiFetch<{ success: boolean; already_exists?: boolean }>("/friends/requests", {
    method: "POST",
    body: JSON.stringify({ to_nickname: toNickname }),
  });
  return { already_exists: Boolean(data.already_exists) };
}

export async function acceptFriendRequest(requestId: string): Promise<void> {
  await ensureValidAccessToken();
  await apiFetch(`/friends/requests/${requestId}/accept`, { method: "POST" });
}

export async function rejectFriendRequest(requestId: string): Promise<void> {
  await ensureValidAccessToken();
  await apiFetch(`/friends/requests/${requestId}/reject`, { method: "POST" });
}
