import { apiFetch } from "./client";
import { ensureValidAccessToken } from "./auth";
import type { BuildDetail, BuildRow } from "./builds";

export type UserPublicProfile = {
  user_id: string;
  nickname: string;
  ely_username?: string | null;
};

export async function fetchUserProfile(userId: string): Promise<UserPublicProfile> {
  await ensureValidAccessToken();
  return apiFetch<UserPublicProfile>(`/users/${userId}`);
}

export async function fetchUserBuilds(userId: string): Promise<BuildRow[]> {
  await ensureValidAccessToken();
  const data = await apiFetch<{ builds: BuildRow[] }>(`/users/${userId}/builds`);
  return data.builds ?? [];
}

export async function fetchUserBuild(userId: string, buildId: string): Promise<BuildDetail> {
  await ensureValidAccessToken();
  return apiFetch<BuildDetail>(`/users/${userId}/builds/${buildId}`);
}
