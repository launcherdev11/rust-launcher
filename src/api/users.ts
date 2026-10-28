import { apiFetch } from "./client";
import { ensureValidAccessToken } from "./auth";

export type UserPublicProfile = {
  user_id: string;
  nickname: string;
  is_sponsor?: boolean;
  ely_username?: string | null;
  mc_uuid?: string | null;
};

export async function fetchUserProfile(userId: string): Promise<UserPublicProfile> {
  await ensureValidAccessToken();
  return apiFetch<UserPublicProfile>(`/users/${userId}`);
}

export type UserSearchRow = {
  user_id: string;
  nickname: string;
  is_sponsor?: boolean;
  is_friend?: boolean;
  request_sent?: boolean;
};

export async function searchUsers(query: string, signal?: AbortSignal): Promise<UserSearchRow[]> {
  await ensureValidAccessToken();
  const data = await apiFetch<{ users: UserSearchRow[] }>(
    `/users/search?q=${encodeURIComponent(query)}`,
    { signal },
  );
  return data.users ?? [];
}
