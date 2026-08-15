import { apiFetch } from "./client";
import { ensureValidAccessToken } from "./auth";

export type PlatformNotification = {
  id: string;
  user_id: string;
  type: "friend_request" | "friend_accept" | "room_invite" | "achievement" | "system" | string;
  payload: Record<string, unknown>;
  created_at: string;
  read_at?: string | null;
};

export async function listNotifications(): Promise<PlatformNotification[]> {
  await ensureValidAccessToken();
  const data = await apiFetch<{ notifications: PlatformNotification[] }>("/notifications");
  return data.notifications ?? [];
}

export async function markNotificationRead(id: string): Promise<void> {
  await ensureValidAccessToken();
  await apiFetch(`/notifications/${id}/read`, { method: "PATCH" });
}

export async function markAllNotificationsRead(): Promise<void> {
  await ensureValidAccessToken();
  await apiFetch("/notifications/read-all", { method: "PATCH" });
}
