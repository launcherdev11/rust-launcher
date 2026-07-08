import { apiFetch } from "./client";
import { ensureValidAccessToken } from "./auth";

export type UserPublicProfile = {
  user_id: string;
  nickname: string;
  ely_username?: string | null;
};

export async function fetchUserProfile(userId: string): Promise<UserPublicProfile> {
  await ensureValidAccessToken();
  return apiFetch<UserPublicProfile>(`/users/${userId}`);
}
