import { apiFetch } from "./client";
import { ensureValidAccessToken } from "./auth";

export type PresenceInfo = {
  user_id: string;
  online: boolean;
  last_seen?: string | null;
};

export async function sendPresenceHeartbeat(): Promise<PresenceInfo> {
  await ensureValidAccessToken();
  const data = await apiFetch<{ presence: PresenceInfo }>("/presence/heartbeat", {
    method: "POST",
  });
  return data.presence;
}

export async function sendPresenceOffline(): Promise<PresenceInfo> {
  await ensureValidAccessToken();
  const data = await apiFetch<{ presence: PresenceInfo }>("/presence/offline", {
    method: "POST",
  });
  return data.presence;
}

export async function fetchMyPresence(): Promise<PresenceInfo> {
  await ensureValidAccessToken();
  const data = await apiFetch<{ presence: PresenceInfo }>("/presence/me");
  return data.presence;
}

export async function fetchFriendsPresence(): Promise<PresenceInfo[]> {
  await ensureValidAccessToken();
  const data = await apiFetch<{ presence: PresenceInfo[] }>("/presence/friends");
  return data.presence ?? [];
}
